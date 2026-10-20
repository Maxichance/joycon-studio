//! Tests sur manettes réelles : `cargo test --lib hardware -- --ignored --nocapture`.
//! LECTURE SEULE sauf la vibration : aucune écriture SPI. Compilé uniquement sous `cfg(test)`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::controller::{spawn, Event};
use crate::protocol::*;

#[test]
#[ignore]
fn read_only_probe_of_connected_joycons() {
    let api = hidapi::HidApi::new().unwrap();
    let found: Vec<_> = api
        .device_list()
        .filter(|d| d.vendor_id() == VID_NINTENDO)
        .collect();
    println!("Périphériques Nintendo : {}", found.len());
    assert!(!found.is_empty(), "aucune manette détectée");

    for d in found {
        let Some(side) = Side::from_pid(d.product_id()) else {
            println!(
                "  (ignoré) pid {:04X} {:?}",
                d.product_id(),
                d.product_string()
            );
            continue;
        };
        let seen = Arc::new(Mutex::new(Vec::<Telemetry>::new()));
        let sink = seen.clone();
        let emit = Arc::new(move |e: Event| {
            if let Event::Telemetry(t) = e {
                sink.lock().unwrap().push(t);
            }
        });
        let dev = api.open_path(d.path()).unwrap();
        let ctrl = spawn(dev, side, "Joy-Con".into(), emit)
            .expect("la manette ne répond pas (endormie ?)");
        println!(
            "== {:?} == fw {} mac {} série « {} »",
            side, ctrl.info.firmware, ctrl.info.mac, ctrl.info.serial
        );

        let (colors, cal) = ctrl
            .run(|c| (c.read_colors(), c.read_calibration()))
            .unwrap();
        let colors = colors.expect("couleurs illisibles");
        println!(
            "   coque {} boutons {} grips {:02x?}",
            hex_of(colors.body),
            hex_of(colors.buttons),
            colors.grips
        );
        println!("   calibration {:?} -> {:?}", cal.1, cal.0);
        assert!(cal.0.is_sane(), "calibration lue non plausible");

        // Sauvegarde complète en mémoire (lecture seule) : doit réussir sans trou.
        let t0 = Instant::now();
        let regions = ctrl
            .run(|c| {
                BACKUP_REGIONS
                    .iter()
                    .map(|&(a, l)| c.read_spi_range(a, l))
                    .collect::<Vec<_>>()
            })
            .unwrap();
        assert!(regions.iter().all(|r| r.is_some()), "lecture SPI à trous");
        println!(
            "   zones de sauvegarde lues sans trou en {:?}",
            t0.elapsed()
        );

        // Télémétrie en direct pendant 1,5 s.
        std::thread::sleep(Duration::from_millis(1500));
        let n = seen.lock().unwrap().len();
        let last = seen
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("aucune télémétrie reçue");
        println!(
            "   {} échantillons de télémétrie en 1,5 s ; stick {:?} ; batterie {:?}",
            n, last.stick, last.battery
        );
        println!("   accel {:?} gyro {:?}", last.accel, last.gyro);
        assert!(n > 15, "flux de télémétrie trop lent : {n}");

        // Vibration brève (seule action physique).
        ctrl.run(|c| c.start_rumble(160.0, 320.0, 0.5, 250))
            .unwrap();
        std::thread::sleep(Duration::from_millis(500));
        ctrl.stop();
    }
}

fn open_side(
    api: &hidapi::HidApi,
    want: Side,
    emit: crate::controller::EmitFn,
) -> crate::controller::Controller {
    let d = api
        .device_list()
        .find(|d| d.vendor_id() == VID_NINTENDO && Side::from_pid(d.product_id()) == Some(want))
        .expect("manette absente");
    spawn(
        api.open_path(d.path()).unwrap(),
        want,
        "Joy-Con".into(),
        emit,
    )
    .expect("manette endormie")
}

/// Réécrit à l'identique les blocs couleurs et calibration utilisateur : valide le
/// chemin d'écriture (accusé + relecture) sans rien changer.
#[test]
#[ignore]
fn rewrite_identical_blocks() {
    let api = hidapi::HidApi::new().unwrap();
    for side in [Side::Left, Side::Right] {
        let ctrl = open_side(&api, side, Arc::new(|_| {}));
        let res = ctrl
            .run(move |c| -> Result<(bool, bool), String> {
                let colors = c.read_spi(SPI_COLORS, 12).ok_or("lecture couleurs")?;
                c.write_spi(SPI_COLORS, &colors)?;
                let addr = SPI_USER_CAL
                    + if side == Side::Right {
                        SPI_USER_CAL_R_OFFSET
                    } else {
                        0
                    };
                let cal = c.read_spi(addr, 11).ok_or("lecture calibration")?;
                let has_user = cal[0] == 0xB2 && cal[1] == 0xA1;
                if has_user {
                    c.write_spi(addr, &cal)?;
                }
                Ok((true, has_user))
            })
            .unwrap();
        println!(
            "{side:?} : couleurs réécrites et vérifiées, calibration utilisateur réécrite = {:?}",
            res
        );
        assert!(res.is_ok());
        ctrl.stop();
    }
}

#[test]
#[ignore]
fn infrared_frame_rate() {
    let api = hidapi::HidApi::new().unwrap();
    let frames = Arc::new(Mutex::new(Vec::<(u32, Instant)>::new()));
    let sink = frames.clone();
    let emit = Arc::new(move |e: Event| {
        if let Event::Ir(f) = e {
            sink.lock().unwrap().push((f.frame_number, Instant::now()));
        }
    });
    let ctrl = open_side(&api, Side::Right, emit);
    for res in ["30p", "60p"] {
        frames.lock().unwrap().clear();
        let settings = crate::ir::IrSettings {
            resolution: res.into(),
            ..Default::default()
        };
        let r = ctrl.run(move |c| crate::ir::start(c, &settings)).unwrap();
        assert!(r.is_ok(), "démarrage IR : {r:?}");
        std::thread::sleep(Duration::from_secs(5));
        let n = frames.lock().unwrap().len();
        println!("{res} : {n} images en 5 s ({} par seconde)", n as f32 / 5.0);
        let stats = ctrl
            .run(|c| c.ir.as_ref().map(|s| s.stats.clone()))
            .unwrap();
        println!("   {stats:?}");
        assert!(n > 0, "aucune image");
    }
    ctrl.run(crate::ir::stop).unwrap();
    ctrl.stop();
}

fn collect_tasks() -> (
    crate::controller::EmitFn,
    Arc<Mutex<Vec<crate::controller::TaskEvent>>>,
) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let sink = log.clone();
    let emit = Arc::new(move |e: Event| {
        if let Event::Task(t) = e {
            sink.lock().unwrap().push(t);
        }
    });
    (emit, log)
}

#[test]
#[ignore]
fn spi_dump_can_be_cancelled() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let api = hidapi::HidApi::new().unwrap();
    let (emit, log) = collect_tasks();
    let ctrl = open_side(&api, Side::Left, emit);
    let path = std::env::temp_dir().join("jcs-cancel-test.bin");
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    ctrl.run(move |c| c.start_dump("t".into(), path, flag))
        .unwrap();
    std::thread::sleep(Duration::from_secs(3));
    cancel.store(true, Ordering::Relaxed);
    std::thread::sleep(Duration::from_secs(1));
    let events = log.lock().unwrap();
    let last = events.last().expect("aucun évènement de tâche");
    println!("dernier état : {} après {} octets", last.state, last.done);
    assert_eq!(last.state, "cancelled");
    assert!(last.done > 0, "rien n'a été lu en 3 s");
    ctrl.stop();
}

#[test]
#[ignore]
fn spi_dump_full_chip() {
    let api = hidapi::HidApi::new().unwrap();
    let (emit, log) = collect_tasks();
    let ctrl = open_side(&api, Side::Left, emit);
    let path = std::env::temp_dir().join("jcs-full-dump.bin");
    let _ = std::fs::remove_file(&path);
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let p = path.clone();
    let t0 = Instant::now();
    ctrl.run(move |c| c.start_dump("full".into(), p, cancel))
        .unwrap();

    let mut last_print = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let (state, done) = {
            let ev = log.lock().unwrap();
            ev.last()
                .map(|e| (e.state, e.done))
                .unwrap_or(("running", 0))
        };
        if last_print.elapsed() > Duration::from_secs(30) {
            println!("  {} / {} octets, {:?}", done, SPI_SIZE, t0.elapsed());
            last_print = Instant::now();
        }
        match state {
            "done" => break,
            "error" | "cancelled" => panic!("copie interrompue : {state}"),
            _ => {}
        }
        assert!(
            t0.elapsed() < Duration::from_secs(1500),
            "copie trop longue"
        );
    }
    println!("copie terminée en {:?}", t0.elapsed());

    let dump = std::fs::read(&path).unwrap();
    assert_eq!(dump.len(), SPI_SIZE, "taille du fichier");

    // Le fichier doit coïncider avec une lecture directe de la puce.
    let (colors, serial, cal) = ctrl
        .run(|c| {
            (
                c.read_spi(SPI_COLORS, 12),
                c.read_spi(SPI_SERIAL, 16),
                c.read_spi(SPI_FACTORY_CAL_L, 9),
            )
        })
        .unwrap();
    assert_eq!(
        &dump[SPI_COLORS as usize..SPI_COLORS as usize + 12],
        colors.unwrap().as_slice(),
        "couleurs"
    );
    assert_eq!(
        &dump[SPI_SERIAL as usize..SPI_SERIAL as usize + 16],
        serial.unwrap().as_slice(),
        "série"
    );
    assert_eq!(
        &dump[SPI_FACTORY_CAL_L as usize..SPI_FACTORY_CAL_L as usize + 9],
        cal.unwrap().as_slice(),
        "calibration d'usine"
    );
    let erased = dump.iter().filter(|&&b| b == 0xFF).count();
    println!(
        "{} octets à 0xFF sur {} (flash vierge attendue en grande partie)",
        erased,
        dump.len()
    );
    assert!(
        erased < dump.len(),
        "puce entièrement vide : lecture douteuse"
    );
    let _ = std::fs::remove_file(&path);
    ctrl.stop();
}
