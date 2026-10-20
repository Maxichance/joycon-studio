//! Le gestionnaire : détecte les manettes, tient leur état et exécute les opérations
//! de haut niveau (couleurs, calibration, sauvegardes, caméra IR, vibration…).
//!
//! Un seul fil de surveillance ouvre et retire les manettes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::backup::{self, Backup, DeviceRef};
use crate::controller::{self, CalSource, Controller, Core, EmitFn, Event};
use crate::ir::{self, IrSettings};
use crate::protocol::*;

/// Erreur renvoyée au front : un code stable (traduit côté interface) + un détail.
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub detail: String,
}

impl From<String> for ApiError {
    fn from(code: String) -> Self {
        ApiError {
            code,
            detail: String::new(),
        }
    }
}

impl From<&str> for ApiError {
    fn from(code: &str) -> Self {
        ApiError {
            code: code.to_string(),
            detail: String::new(),
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

struct Entry {
    ctrl: Arc<Controller>,
    colors: Mutex<(String, String)>,
    cal: Mutex<(StickCal, CalSource)>,
}

#[derive(Clone, Serialize)]
pub struct ControllerView {
    pub side: Side,
    pub name: String,
    pub firmware: String,
    pub mac: String,
    pub serial: String,
    pub body: String,
    pub buttons: String,
    pub cal: StickCal,
    pub cal_source: CalSource,
    pub battery: Option<Battery>,
    pub demo: bool,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub controllers: Vec<ControllerView>,
    /// Manettes Nintendo détectées mais non prises en charge (Pro, Switch 2…).
    pub unsupported: Vec<String>,
    pub demo: bool,
}

#[derive(Serialize)]
pub struct WriteReport {
    pub backup_id: Option<String>,
    pub simulated: bool,
}

pub struct App {
    handle: AppHandle,
    pub backup_dir: PathBuf,
    entries: Mutex<HashMap<Side, Arc<Entry>>>,
    unsupported: Mutex<Vec<String>>,
    demo: Arc<AtomicBool>,
    demo_colors: Mutex<HashMap<Side, (String, String)>>,
    wake: Mutex<Sender<()>>,
    tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn device_ref(c: &Controller) -> DeviceRef {
    DeviceRef {
        name: c.name.clone(),
        mac: c.info.mac.clone(),
        firmware: c.info.firmware.clone(),
        serial: c.info.serial.clone(),
    }
}

/// Lit toutes les zones à sauvegarder ; une lecture manquée annule l'opération.
fn read_backup_regions(c: &mut Core) -> Result<Vec<(u32, Vec<u8>)>, String> {
    BACKUP_REGIONS
        .iter()
        .map(|&(addr, len)| {
            c.read_spi_range(addr, len)
                .map(|d| (addr, d))
                .ok_or_else(|| "backup_failed".to_string())
        })
        .collect()
}

fn user_cal_addr(side: Side) -> u32 {
    SPI_USER_CAL
        + if side == Side::Right {
            SPI_USER_CAL_R_OFFSET
        } else {
            0
        }
}

impl App {
    pub fn new(handle: AppHandle, backup_dir: PathBuf) -> (Arc<App>, Receiver<()>) {
        let (tx, rx) = mpsc::channel();
        let app = Arc::new(App {
            handle,
            backup_dir,
            entries: Mutex::new(HashMap::new()),
            unsupported: Mutex::new(Vec::new()),
            demo: Arc::new(AtomicBool::new(false)),
            demo_colors: Mutex::new(HashMap::new()),
            wake: Mutex::new(tx),
            tasks: Mutex::new(HashMap::new()),
        });
        (app, rx)
    }

    fn emit_fn(&self) -> EmitFn {
        let h = self.handle.clone();
        let demo = self.demo.clone();
        Arc::new(move |e: Event| {
            // Pendant la démo, les vraies manettes se taisent.
            if demo.load(Ordering::Relaxed) && !matches!(e, Event::Task(_)) {
                return;
            }
            let _ = h.emit("joycon:event", &e);
        })
    }

    pub fn is_demo(&self) -> bool {
        self.demo.load(Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> Snapshot {
        if self.is_demo() {
            let colors = self.demo_colors.lock().unwrap();
            let view = |side: Side| {
                let (body, buttons) = colors.get(&side).cloned().unwrap_or_else(|| match side {
                    Side::Left => ("#0AB9E6".into(), "#1E2226".into()),
                    Side::Right => ("#FF3C28".into(), "#1E2226".into()),
                });
                ControllerView {
                    side,
                    name: format!("Joy-Con ({})", if side == Side::Left { "L" } else { "R" }),
                    firmware: "demo".into(),
                    mac: "00:00:00:00:00:00".into(),
                    serial: "DEMO".into(),
                    body,
                    buttons,
                    cal: StickCal {
                        center: [2110, 1960],
                        above: [1385, 1342],
                        below: [1310, 1362],
                    },
                    cal_source: CalSource::User,
                    battery: Some(Battery {
                        level: BatteryLevel::Full,
                        charging: false,
                    }),
                    demo: true,
                }
            };
            return Snapshot {
                controllers: vec![view(Side::Left), view(Side::Right)],
                unsupported: vec![],
                demo: true,
            };
        }
        let entries = self.entries.lock().unwrap();
        let mut controllers: Vec<ControllerView> = entries
            .values()
            .map(|e| {
                let (body, buttons) = e.colors.lock().unwrap().clone();
                let (cal, cal_source) = *e.cal.lock().unwrap();
                ControllerView {
                    side: e.ctrl.side,
                    name: e.ctrl.name.clone(),
                    firmware: e.ctrl.info.firmware.clone(),
                    mac: e.ctrl.info.mac.clone(),
                    serial: e.ctrl.info.serial.clone(),
                    body,
                    buttons,
                    cal,
                    cal_source,
                    battery: e
                        .ctrl
                        .shared
                        .latest
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map(|t| t.battery.clone()),
                    demo: false,
                }
            })
            .collect();
        controllers.sort_by_key(|c| c.side);
        Snapshot {
            controllers,
            unsupported: self.unsupported.lock().unwrap().clone(),
            demo: false,
        }
    }

    pub fn publish(&self) {
        let _ = self.handle.emit("joycon:devices", self.snapshot());
    }

    pub fn rescan(&self) {
        let _ = self.wake.lock().unwrap().send(());
    }

    fn entry(&self, side: Side) -> ApiResult<Arc<Entry>> {
        self.entries
            .lock()
            .unwrap()
            .get(&side)
            .cloned()
            .ok_or_else(|| "no_controller".into())
    }

    // --- Surveillance ---------------------------------------------------------------

    /// Fil de surveillance : ouvre les manettes éveillées, retire les silencieuses.
    pub fn monitor(self: Arc<Self>, wake_rx: Receiver<()>) {
        let mut api = match hidapi::HidApi::new() {
            Ok(a) => a,
            Err(_) => return,
        };
        let mut last_probe: HashMap<Side, Instant> = HashMap::new();
        loop {
            let mut changed = false;
            if !self.is_demo() {
                // Retrait des manettes qui ont cessé d'émettre.
                {
                    let mut entries = self.entries.lock().unwrap();
                    let dead: Vec<Side> = entries
                        .iter()
                        .filter(|(_, e)| !e.ctrl.is_alive())
                        .map(|(s, _)| *s)
                        .collect();
                    for s in dead {
                        entries.remove(&s);
                        changed = true;
                    }
                }

                let _ = api.refresh_devices();
                let mut unsupported = Vec::new();
                let mut candidates = Vec::new();
                for d in api.device_list().filter(|d| d.vendor_id() == VID_NINTENDO) {
                    match Side::from_pid(d.product_id()) {
                        Some(side) => candidates.push((side, d.path().to_owned())),
                        None => unsupported.push(
                            d.product_string()
                                .map(String::from)
                                .unwrap_or_else(|| format!("0x{:04X}", d.product_id())),
                        ),
                    }
                }
                unsupported.sort();
                unsupported.dedup();
                {
                    let mut u = self.unsupported.lock().unwrap();
                    if *u != unsupported {
                        *u = unsupported;
                        changed = true;
                    }
                }

                for (side, path) in candidates {
                    if self.entries.lock().unwrap().contains_key(&side) {
                        continue;
                    }
                    // Une manette endormie coûte une demi-seconde à sonder : pas plus d'une fois par 3 s.
                    if last_probe
                        .get(&side)
                        .is_some_and(|t| t.elapsed() < Duration::from_secs(3))
                    {
                        continue;
                    }
                    last_probe.insert(side, Instant::now());
                    let Ok(dev) = api.open_path(&path) else {
                        continue;
                    };
                    let name = match side {
                        Side::Left => "Joy-Con (L)",
                        Side::Right => "Joy-Con (R)",
                    }
                    .to_string();
                    let Ok(ctrl) = controller::spawn(dev, side, name, self.emit_fn()) else {
                        continue;
                    };
                    let ctrl = Arc::new(ctrl);
                    let init = ctrl.run(|c| {
                        let colors = c.read_colors();
                        let cal = c.read_calibration();
                        (colors, cal)
                    });
                    let (colors, cal) = match init {
                        Ok((Some(colors), cal)) => (colors, cal),
                        _ => {
                            ctrl.stop();
                            continue;
                        }
                    };
                    let entry = Entry {
                        ctrl,
                        colors: Mutex::new((hex_of(colors.body), hex_of(colors.buttons))),
                        cal: Mutex::new(cal),
                    };
                    self.entries.lock().unwrap().insert(side, Arc::new(entry));
                    changed = true;
                }
            }
            if changed {
                self.publish();
            }
            // Réveil anticipé sur demande de rescan.
            let _ = wake_rx.recv_timeout(Duration::from_millis(1500));
        }
    }

    // --- Mode démo --------------------------------------------------------------------

    pub fn set_demo(self: &Arc<Self>, on: bool) {
        if self.demo.swap(on, Ordering::Relaxed) == on {
            return;
        }
        if on {
            let app = self.clone();
            std::thread::spawn(move || app.demo_loop());
        }
        self.publish();
        if !on {
            self.rescan();
        }
    }

    fn demo_loop(&self) {
        const POOL_L: [&str; 6] = ["up", "left", "zl", "l", "minus", "capture"];
        const POOL_R: [&str; 6] = ["a", "b", "x", "y", "zr", "plus"];
        let t0 = Instant::now();
        while self.is_demo() {
            let t = t0.elapsed().as_secs_f32();
            for (side, pool, phase) in [(Side::Left, POOL_L, 0.0f32), (Side::Right, POOL_R, 1.7)] {
                let (x, y) = (
                    ((t * 1.3 + phase).cos() * 0.8),
                    ((t * 1.3 + phase).sin() * 0.8),
                );
                let pressed = if (t * 0.8 + phase).fract() < 0.35 {
                    vec![pool[((t * 0.8 + phase) as usize) % pool.len()]]
                } else {
                    vec![]
                };
                let tel = Telemetry {
                    side,
                    pressed,
                    stick: StickState {
                        x,
                        y,
                        raw_x: (2048.0 + x * 1200.0) as u16,
                        raw_y: (2048.0 + y * 1200.0) as u16,
                    },
                    battery: Battery {
                        level: BatteryLevel::Full,
                        charging: false,
                    },
                    accel: [0.02, -0.01, if side == Side::Right { -1.0 } else { 1.0 }],
                    gyro: [
                        (t * 2.0).sin() * 40.0,
                        (t * 1.5).cos() * 25.0,
                        (t).sin() * 10.0,
                    ],
                };
                let _ = self.handle.emit("joycon:event", &Event::Telemetry(tel));
            }
            std::thread::sleep(Duration::from_millis(33));
        }
    }

    // --- Couleurs ---------------------------------------------------------------------

    pub fn read_colors(&self, side: Side) -> ApiResult<(String, String)> {
        if self.is_demo() {
            return Ok(self
                .snapshot()
                .controllers
                .iter()
                .find(|c| c.side == side)
                .map(|c| (c.body.clone(), c.buttons.clone()))
                .unwrap());
        }
        let e = self.entry(side)?;
        let block = e.ctrl.run(|c| c.read_colors())?.ok_or("read_failed")?;
        let colors = (hex_of(block.body), hex_of(block.buttons));
        *e.colors.lock().unwrap() = colors.clone();
        self.publish();
        Ok(colors)
    }

    /// Sauvegarde vérifiée → écriture → relecture de contrôle. Les poignées sont conservées.
    pub fn write_colors(&self, side: Side, body: &str, buttons: &str) -> ApiResult<WriteReport> {
        let (body, buttons) = (parse_hex(body)?, parse_hex(buttons)?);
        if self.is_demo() {
            self.demo_colors
                .lock()
                .unwrap()
                .insert(side, (hex_of(body), hex_of(buttons)));
            self.publish();
            return Ok(WriteReport {
                backup_id: None,
                simulated: true,
            });
        }
        let e = self.entry(side)?;
        let (dir, dev) = (self.backup_dir.clone(), device_ref(&e.ctrl));
        let (id, block) = e
            .ctrl
            .run(move |c| -> Result<(String, ColorBlock), String> {
                let regions = read_backup_regions(c)?;
                let b = backup::create(&dir, side, "colors", dev, regions)
                    .map_err(|_| "backup_failed".to_string())?;
                let mut block = c.read_colors().ok_or("read_failed")?;
                block.body = body;
                block.buttons = buttons;
                c.write_spi(SPI_COLORS, &block.encode())?;
                Ok((b.id, block))
            })??;
        *e.colors.lock().unwrap() = (hex_of(block.body), hex_of(block.buttons));
        self.publish();
        Ok(WriteReport {
            backup_id: Some(id),
            simulated: false,
        })
    }

    // --- Calibration --------------------------------------------------------------------

    pub fn write_calibration(&self, side: Side, cal: StickCal) -> ApiResult<WriteReport> {
        if !cal.is_sane() {
            return Err("unsafe_calibration".into());
        }
        if self.is_demo() {
            return Ok(WriteReport {
                backup_id: None,
                simulated: true,
            });
        }
        let e = self.entry(side)?;
        let (dir, dev) = (self.backup_dir.clone(), device_ref(&e.ctrl));
        let id = e.ctrl.run(move |c| -> Result<String, String> {
            let regions = read_backup_regions(c)?;
            let b = backup::create(&dir, side, "calibration", dev, regions)
                .map_err(|_| "backup_failed".to_string())?;
            let mut block = vec![0xB2, 0xA1];
            block.extend_from_slice(&cal.encode(side));
            c.write_spi(user_cal_addr(side), &block)?;
            c.cal = cal;
            Ok(b.id)
        })??;
        *e.cal.lock().unwrap() = (cal, CalSource::User);
        self.publish();
        Ok(WriteReport {
            backup_id: Some(id),
            simulated: false,
        })
    }

    /// Efface le bloc utilisateur : la manette retombe sur sa calibration d'usine.
    pub fn reset_calibration(&self, side: Side) -> ApiResult<WriteReport> {
        if self.is_demo() {
            return Ok(WriteReport {
                backup_id: None,
                simulated: true,
            });
        }
        let e = self.entry(side)?;
        let (dir, dev) = (self.backup_dir.clone(), device_ref(&e.ctrl));
        let (id, cal) = e.ctrl.run(
            move |c| -> Result<(String, (StickCal, CalSource)), String> {
                let regions = read_backup_regions(c)?;
                let b = backup::create(&dir, side, "reset", dev, regions)
                    .map_err(|_| "backup_failed".to_string())?;
                c.write_spi(user_cal_addr(side), &[0xFF; 11])?;
                let cal = c.read_calibration();
                c.cal = cal.0;
                Ok((b.id, cal))
            },
        )??;
        *e.cal.lock().unwrap() = cal;
        self.publish();
        Ok(WriteReport {
            backup_id: Some(id),
            simulated: false,
        })
    }

    // --- Sauvegardes ----------------------------------------------------------------------

    pub fn list_backups(&self) -> Vec<Backup> {
        backup::list(&self.backup_dir)
    }

    pub fn delete_backup(&self, id: &str) -> ApiResult<()> {
        backup::delete(&self.backup_dir, id).map_err(Into::into)
    }

    /// Restaure couleurs et calibration utilisateur d'une sauvegarde, après en avoir fait une nouvelle.
    pub fn restore_backup(&self, id: &str) -> ApiResult<WriteReport> {
        let b = backup::load(&self.backup_dir, id)?;
        if self.is_demo() {
            return Ok(WriteReport {
                backup_id: None,
                simulated: true,
            });
        }
        let side = b.side;
        let e = self.entry(side)?;
        // Une sauvegarde d'un autre exemplaire ne doit jamais être appliquée ici.
        if !b.device.mac.is_empty()
            && !e.ctrl.info.mac.is_empty()
            && b.device.mac != e.ctrl.info.mac
        {
            return Err("backup_other_device".into());
        }
        let colors = b.bytes_at(SPI_COLORS, 12).ok_or("invalid_backup")?;
        let user_cal = b.bytes_at(SPI_USER_CAL, 24).ok_or("invalid_backup")?;
        let (dir, dev) = (self.backup_dir.clone(), device_ref(&e.ctrl));
        let (new_id, block, cal) = e.ctrl.run(
            move |c| -> Result<(String, ColorBlock, (StickCal, CalSource)), String> {
                let regions = read_backup_regions(c)?;
                let nb = backup::create(&dir, side, "restore", dev, regions)
                    .map_err(|_| "backup_failed".to_string())?;
                c.write_spi(SPI_COLORS, &colors)?;
                c.write_spi(SPI_USER_CAL, &user_cal)?;
                let block = c.read_colors().ok_or("read_failed")?;
                let cal = c.read_calibration();
                c.cal = cal.0;
                Ok((nb.id, block, cal))
            },
        )??;
        *e.colors.lock().unwrap() = (hex_of(block.body), hex_of(block.buttons));
        *e.cal.lock().unwrap() = cal;
        self.publish();
        Ok(WriteReport {
            backup_id: Some(new_id),
            simulated: false,
        })
    }

    // --- Tâches longues ----------------------------------------------------------------------

    pub fn start_spi_dump(&self, side: Side, path: PathBuf) -> ApiResult<String> {
        if self.is_demo() {
            return Err("demo".into());
        }
        let e = self.entry(side)?;
        let id = format!("dump-{}-{}", side.name(), self.tasks.lock().unwrap().len());
        let cancel = Arc::new(AtomicBool::new(false));
        self.tasks
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());
        let tid = id.clone();
        e.ctrl.run(move |c| c.start_dump(tid, path, cancel))?;
        Ok(id)
    }

    pub fn cancel_task(&self, id: &str) {
        if let Some(flag) = self.tasks.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    // --- Vibration, LED ---------------------------------------------------------------------

    fn targets(&self, side: Option<Side>) -> Vec<Arc<Entry>> {
        let entries = self.entries.lock().unwrap();
        match side {
            Some(s) => entries.get(&s).cloned().into_iter().collect(),
            None => entries.values().cloned().collect(),
        }
    }

    pub fn rumble(
        &self,
        side: Option<Side>,
        low: f32,
        high: f32,
        amp: f32,
        ms: u64,
    ) -> ApiResult<()> {
        if self.is_demo() {
            return Ok(());
        }
        let t = self.targets(side);
        if t.is_empty() {
            return Err("no_controller".into());
        }
        for e in t {
            e.ctrl.run(move |c| c.start_rumble(low, high, amp, ms))?;
        }
        Ok(())
    }

    /// La bague lumineuse n'existe que sur le Joy-Con droit.
    pub fn home_light(&self, mode: HomeMode, intensity: u8) -> ApiResult<()> {
        if self.is_demo() {
            return Ok(());
        }
        let e = self
            .entry(Side::Right)
            .map_err(|_| ApiError::from("home_needs_right"))?;
        if e.ctrl.run(move |c| c.home_light(mode, intensity))? {
            Ok(())
        } else {
            Err("timeout".into())
        }
    }

    pub fn player_leds(&self, mask: u8) -> ApiResult<()> {
        if self.is_demo() {
            return Ok(());
        }
        let t = self.targets(None);
        if t.is_empty() {
            return Err("no_controller".into());
        }
        for e in t {
            e.ctrl.run(move |c| c.player_leds(mask))?;
        }
        Ok(())
    }

    // --- Caméra IR ---------------------------------------------------------------------------

    fn right(&self) -> ApiResult<Arc<Entry>> {
        if self.is_demo() {
            return Err("demo".into());
        }
        self.entry(Side::Right).map_err(|_| "ir_needs_right".into())
    }

    pub fn ir_start(&self, s: IrSettings) -> ApiResult<()> {
        self.right()?.ctrl.run(move |c| ir::start(c, &s))??;
        Ok(())
    }

    pub fn ir_apply(&self, s: IrSettings) -> ApiResult<()> {
        self.right()?.ctrl.run(move |c| ir::apply(c, &s))??;
        Ok(())
    }

    pub fn ir_stop(&self) -> ApiResult<()> {
        if let Ok(e) = self.right() {
            e.ctrl.run(ir::stop)?;
        }
        Ok(())
    }

    pub fn ir_write_register(&self, addr: u16, val: u8) -> ApiResult<()> {
        self.right()?
            .ctrl
            .run(move |c| ir::write_register(c, addr, val))??;
        Ok(())
    }
}
