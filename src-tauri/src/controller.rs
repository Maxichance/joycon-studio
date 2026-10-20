//! Une manette, un fil. Ce fil est le seul à toucher au périphérique HID : il lit en
//! boucle et exécute les opérations demandées entre deux rapports. Deux lecteurs sur
//! le même handle se voleraient les réponses.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hidapi::HidDevice;
use serde::Serialize;

use crate::ir::IrState;
use crate::protocol::*;

const OUTPUT_LEN: usize = 49;
const IN_BUF: usize = 400;
const SILENCE_LIMIT: Duration = Duration::from_millis(2500);

/// Tout ce que le fil d'une manette peut annoncer au reste de l'application.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    Telemetry(Telemetry),
    Ir(crate::ir::IrFrame),
    Task(TaskEvent),
}

#[derive(Clone, Serialize)]
pub struct TaskEvent {
    pub id: String,
    pub kind: &'static str,
    pub done: u64,
    pub total: u64,
    /// `running` | `done` | `error` | `cancelled`
    pub state: &'static str,
    pub message: Option<String>,
}

pub type EmitFn = Arc<dyn Fn(Event) + Send + Sync>;

/// État partagé, lisible depuis n'importe quel fil sans parler à la manette.
pub struct Shared {
    pub alive: AtomicBool,
    pub latest: Mutex<Option<Telemetry>>,
}

struct DumpJob {
    id: String,
    path: PathBuf,
    buf: Vec<u8>,
    cancel: Arc<AtomicBool>,
    fails: u8,
}

/// Le côté « fil de la manette » : tout ce qui touche au HID vit ici.
pub struct Core {
    pub side: Side,
    dev: HidDevice,
    counter: u8,
    rumble: [u8; 8],
    rumble_until: Option<Instant>,
    rumble_next: Instant,
    pub last_report: Instant,
    pub cal: StickCal,
    emit: EmitFn,
    last_emit: Instant,
    shared: Arc<Shared>,
    pub ir: Option<IrState>,
    dump: Option<DumpJob>,
}

pub struct DeviceInfo {
    pub firmware: String,
    pub mac: String,
    pub serial: String,
}

impl Core {
    // --- Entrées / sorties brutes ---------------------------------------------------

    pub fn write_raw(&mut self, pkt: &[u8]) -> Result<(), String> {
        self.dev.write(pkt).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Lit un rapport avec délai. `None` = rien reçu.
    pub fn read_report(&mut self, timeout_ms: i32) -> Option<Vec<u8>> {
        let mut buf = [0u8; IN_BUF];
        match self.dev.read_timeout(&mut buf, timeout_ms) {
            Ok(n) if n > 0 => {
                self.last_report = Instant::now();
                Some(buf[..n].to_vec())
            }
            _ => None,
        }
    }

    pub fn next_counter(&mut self) -> u8 {
        self.counter = (self.counter + 1) & 0x0F;
        self.counter
    }

    pub fn rumble_bytes(&self) -> [u8; 8] {
        self.rumble
    }

    /// Envoie un rapport de sortie 0x01 (sous-commande) sans attendre de réponse.
    fn send_subcommand(&mut self, sub: u8, data: &[u8]) -> Result<(), String> {
        let mut pkt = [0u8; OUTPUT_LEN];
        pkt[0] = 0x01;
        pkt[1] = self.next_counter();
        pkt[2..10].copy_from_slice(&self.rumble);
        pkt[10] = sub;
        let n = data.len().min(OUTPUT_LEN - 11);
        pkt[11..11 + n].copy_from_slice(&data[..n]);
        self.write_raw(&pkt)
    }

    /// Envoie une sous-commande et attend son accusé (rapport 0x21). Les autres
    /// rapports reçus pendant l'attente continuent d'alimenter la télémétrie.
    pub fn subcommand(&mut self, sub: u8, data: &[u8], timeout_ms: u64) -> Option<Vec<u8>> {
        self.send_subcommand(sub, data).ok()?;
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        while Instant::now() < deadline {
            let Some(raw) = self.read_report(20) else {
                continue;
            };
            if raw[0] == 0x21 && raw.len() > 14 && raw[14] == sub {
                self.on_standard(&raw);
                return Some(raw);
            }
            self.dispatch(&raw);
        }
        None
    }

    // --- SPI ----------------------------------------------------------------------

    /// Lit `len` (≤ 0x1D) octets, avec trois essais.
    pub fn read_spi(&mut self, addr: u32, len: usize) -> Option<Vec<u8>> {
        let len = len.min(SPI_CHUNK);
        let mut req = addr.to_le_bytes().to_vec();
        req.push(len as u8);
        for _ in 0..3 {
            if let Some(r) = self.subcommand(0x10, &req, 800) {
                if r.len() >= 20 + len
                    && r[13] & 0x80 != 0
                    && r[15..19] == addr.to_le_bytes()
                    && r[19] as usize == len
                {
                    return Some(r[20..20 + len].to_vec());
                }
            }
        }
        None
    }

    /// Lit une zone de longueur quelconque. `None` si **un seul** morceau échoue :
    /// une sauvegarde à trous est pire que pas de sauvegarde.
    pub fn read_spi_range(&mut self, addr: u32, len: usize) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(len);
        while out.len() < len {
            let n = (len - out.len()).min(SPI_CHUNK);
            out.extend(self.read_spi(addr + out.len() as u32, n)?);
        }
        Some(out)
    }

    /// Écrit, puis relit pour vérifier. Refuse toute adresse hors de la liste blanche.
    pub fn write_spi(&mut self, addr: u32, data: &[u8]) -> Result<(), String> {
        if data.is_empty() || data.len() > SPI_CHUNK || !is_writable(addr, data.len()) {
            return Err("write_refused".into());
        }
        let mut req = addr.to_le_bytes().to_vec();
        req.push(data.len() as u8);
        req.extend_from_slice(data);
        let reply = self.subcommand(0x11, &req, 1500).ok_or("timeout")?;
        if reply.len() < 16 || reply[13] & 0x80 == 0 || reply[15] != 0 {
            return Err("write_failed".into());
        }
        std::thread::sleep(Duration::from_millis(30));
        match self.read_spi(addr, data.len()) {
            Some(back) if back == data => Ok(()),
            _ => Err("verify_failed".into()),
        }
    }

    pub fn read_colors(&mut self) -> Option<ColorBlock> {
        ColorBlock::decode(&self.read_spi(SPI_COLORS, 12)?)
    }

    /// Calibration active : bloc utilisateur s'il est valide, sinon calibration d'usine.
    pub fn read_calibration(&mut self) -> (StickCal, CalSource) {
        let side = self.side;
        let user_addr = SPI_USER_CAL
            + if side == Side::Right {
                SPI_USER_CAL_R_OFFSET
            } else {
                0
            };
        if let Some(b) = self.read_spi(user_addr, 11) {
            if b.len() == 11 && b[0] == 0xB2 && b[1] == 0xA1 {
                if let Some(c) = StickCal::decode(&b[2..], side) {
                    return (c, CalSource::User);
                }
            }
        }
        let fac = if side == Side::Left {
            SPI_FACTORY_CAL_L
        } else {
            SPI_FACTORY_CAL_R
        };
        if let Some(c) = self
            .read_spi(fac, 9)
            .and_then(|b| StickCal::decode(&b, side))
        {
            return (c, CalSource::Factory);
        }
        (StickCal::fallback(), CalSource::Default)
    }

    // --- Vibration -----------------------------------------------------------------

    pub fn start_rumble(&mut self, low: f32, high: f32, amp: f32, ms: u64) {
        let b = encode_rumble(low, high, amp);
        self.rumble[0..4].copy_from_slice(&b);
        self.rumble[4..8].copy_from_slice(&b);
        self.rumble_until = Some(Instant::now() + Duration::from_millis(ms.min(5000)));
        self.rumble_next = Instant::now();
    }

    fn tick_rumble(&mut self) {
        let Some(until) = self.rumble_until else {
            return;
        };
        let now = Instant::now();
        if now >= until {
            self.rumble = RUMBLE_NEUTRAL;
            self.rumble_until = None;
            self.send_rumble_only();
        } else if now >= self.rumble_next {
            self.send_rumble_only();
            self.rumble_next = now + Duration::from_millis(15);
        }
    }

    fn send_rumble_only(&mut self) {
        let mut pkt = [0u8; OUTPUT_LEN];
        pkt[0] = 0x10;
        pkt[1] = self.next_counter();
        pkt[2..10].copy_from_slice(&self.rumble);
        let _ = self.write_raw(&pkt);
    }

    pub fn home_light(&mut self, mode: HomeMode, intensity: u8) -> bool {
        self.subcommand(0x38, &home_light_pattern(mode, intensity), 600)
            .is_some()
    }

    pub fn player_leds(&mut self, mask: u8) -> bool {
        self.subcommand(0x30, &[mask & 0x0F], 500).is_some()
    }

    // --- Dispatch des rapports ------------------------------------------------------

    pub fn dispatch(&mut self, raw: &[u8]) {
        match raw[0] {
            0x30 | 0x21 => self.on_standard(raw),
            0x31 => {
                self.on_standard(raw);
                if self.ir.is_some() && raw.len() >= 50 {
                    crate::ir::on_packet(self, raw);
                }
            }
            _ => {}
        }
    }

    fn on_standard(&mut self, raw: &[u8]) {
        let Some(t) = parse_standard(self.side, raw, &self.cal) else {
            return;
        };
        *self.shared.latest.lock().unwrap() = Some(t.clone());
        if self.last_emit.elapsed() >= Duration::from_millis(25) {
            self.last_emit = Instant::now();
            (self.emit)(Event::Telemetry(t));
        }
    }

    pub fn emit(&self, e: Event) {
        (self.emit)(e)
    }

    // --- Dump complet de la puce ------------------------------------------------------

    fn dump_step(&mut self) {
        let Some(mut job) = self.dump.take() else {
            return;
        };
        let task = |job: &DumpJob, state: &'static str, msg: Option<String>| {
            Event::Task(TaskEvent {
                id: job.id.clone(),
                kind: "spi_dump",
                done: job.buf.len() as u64,
                total: SPI_SIZE as u64,
                state,
                message: msg,
            })
        };
        if job.cancel.load(Ordering::Relaxed) {
            self.emit(task(&job, "cancelled", None));
            return;
        }
        let addr = job.buf.len();
        match self.read_spi(addr as u32, (SPI_SIZE - addr).min(SPI_CHUNK)) {
            Some(chunk) => {
                job.buf.extend(chunk);
                job.fails = 0;
            }
            None => {
                job.fails += 1;
                if job.fails >= 5 {
                    self.emit(task(&job, "error", Some("read_failed".into())));
                    return;
                }
            }
        }
        if job.buf.len() >= SPI_SIZE {
            let res = std::fs::write(&job.path, &job.buf);
            match res {
                Ok(()) => self.emit(task(
                    &job,
                    "done",
                    Some(job.path.to_string_lossy().into_owned()),
                )),
                Err(e) => self.emit(task(&job, "error", Some(e.to_string()))),
            }
            return;
        }
        // ~0,5 % par message : assez fluide, sans saturer le canal d'événements.
        if (job.buf.len() / SPI_CHUNK) % 90 == 0 {
            self.emit(task(&job, "running", None));
        }
        self.dump = Some(job);
    }

    pub fn start_dump(&mut self, id: String, path: PathBuf, cancel: Arc<AtomicBool>) {
        self.dump = Some(DumpJob {
            id,
            path,
            buf: Vec::with_capacity(SPI_SIZE),
            cancel,
            fails: 0,
        });
    }

    /// Prochaine étape : appelée par la boucle principale.
    fn maintenance(&mut self) {
        self.tick_rumble();
        if self.dump.is_some() {
            self.dump_step();
        }
        if self.ir.is_some() {
            crate::ir::maintenance(self);
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CalSource {
    User,
    Factory,
    Default,
}

type Job = Box<dyn FnOnce(&mut Core) + Send>;

enum Msg {
    Run(Job),
    Stop,
}

/// Poignée côté application : envoie du travail au fil de la manette.
pub struct Controller {
    pub side: Side,
    pub name: String,
    pub info: DeviceInfo,
    pub shared: Arc<Shared>,
    tx: Sender<Msg>,
}

impl Controller {
    /// Exécute `f` sur le fil de la manette et rend son résultat.
    pub fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Core) -> T + Send + 'static,
    ) -> Result<T, String> {
        let (rtx, rrx) = mpsc::channel();
        self.tx
            .send(Msg::Run(Box::new(move |c| {
                let _ = rtx.send(f(c));
            })))
            .map_err(|_| "no_controller".to_string())?;
        rrx.recv_timeout(Duration::from_secs(60))
            .map_err(|_| "timeout".to_string())
    }

    pub fn is_alive(&self) -> bool {
        self.shared.alive.load(Ordering::Relaxed)
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

/// Ouvre une manette : vérifie qu'elle émet vraiment (une manette appairée mais
/// endormie s'ouvre quand même sous Windows), la configure et lance son fil.
pub fn spawn(dev: HidDevice, side: Side, name: String, emit: EmitFn) -> Result<Controller, String> {
    let shared = Arc::new(Shared {
        alive: AtomicBool::new(true),
        latest: Mutex::new(None),
    });
    let mut core = Core {
        side,
        dev,
        counter: 0,
        rumble: RUMBLE_NEUTRAL,
        rumble_until: None,
        rumble_next: Instant::now(),
        last_report: Instant::now(),
        cal: StickCal::fallback(),
        emit,
        last_emit: Instant::now(),
        shared: shared.clone(),
        ir: None,
        dump: None,
    };

    // Sonde de vie : une manette éveillée répond à « informations ».
    let reply = core.subcommand(0x02, &[], 600).ok_or("asleep")?;
    let firmware = if reply.len() >= 17 {
        format!("{}.{:02X}", reply[15], reply[16])
    } else {
        String::new()
    };
    let mac = if reply.len() >= 25 {
        reply[19..25]
            .iter()
            .rev()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(":")
    } else {
        String::new()
    };

    // Mode de rapport standard à 60 Hz, gyroscope et vibration activés.
    core.subcommand(0x03, &[0x30], 800);
    core.subcommand(0x40, &[0x01], 500);
    core.subcommand(0x48, &[0x01], 500);

    let serial = core
        .read_spi(SPI_SERIAL, 16)
        .map(|b| {
            if b.first() == Some(&0xFF) {
                String::new()
            } else {
                b.iter()
                    .filter(|c| c.is_ascii_graphic())
                    .map(|&c| c as char)
                    .collect()
            }
        })
        .unwrap_or_default();
    core.cal = core.read_calibration().0;

    let (tx, rx): (Sender<Msg>, Receiver<Msg>) = mpsc::channel();
    let sh = shared.clone();
    std::thread::Builder::new()
        .name(format!("joycon-{}", side.name()))
        .spawn(move || {
            'outer: loop {
                while let Ok(msg) = rx.try_recv() {
                    match msg {
                        Msg::Run(f) => f(&mut core),
                        Msg::Stop => break 'outer,
                    }
                }
                core.maintenance();
                if let Some(raw) = core.read_report(8) {
                    core.dispatch(&raw);
                } else if core.last_report.elapsed() > SILENCE_LIMIT {
                    break;
                }
            }
            sh.alive.store(false, Ordering::Relaxed);
        })
        .map_err(|e| e.to_string())?;

    Ok(Controller {
        side,
        name,
        info: DeviceInfo {
            firmware,
            mac,
            serial,
        },
        shared,
        tx,
    })
}
