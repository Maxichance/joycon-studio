//! Caméra infrarouge du Joy-Con (R), pilotée via le MCU.
//!
//! Le MCU n'envoie le fragment suivant que si l'hôte accuse réception du précédent
//! dans une fenêtre très courte. Comme le fil de la manette est l'unique lecteur du
//! périphérique, l'accusé part dans la foulée de la lecture, sans aucun intermédiaire.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::controller::{Core, Event};
use crate::protocol::{crc8, Side};

const FRAG_LEN: usize = 300;

/// (registre de résolution, nombre max de fragments - 1, largeur, hauteur)
pub fn mode_of(res: &str) -> (u8, u8, usize, usize) {
    match res {
        "240p" => (0x00, 0xFF, 320, 240),
        "120p" => (0x50, 0x3F, 160, 120),
        "60p" => (0x64, 0x0F, 80, 60),
        _ => (0x69, 0x03, 40, 30),
    }
}

/// Réglages du capteur. Le front les possède et les renvoie en bloc.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct IrSettings {
    pub resolution: String,
    pub led_far: bool,
    pub led_near: bool,
    pub led_far_intensity: u8,
    pub led_near_intensity: u8,
    pub flashlight: bool,
    pub strobe: bool,
    pub ex_light_filter: bool,
    pub selfie: bool,
    pub exposure_us: u32,
    pub auto_exposure: bool,
    pub gain: u8,
    pub denoise: bool,
    pub denoise_edge: u8,
    pub denoise_color: u8,
}

impl Default for IrSettings {
    fn default() -> Self {
        IrSettings {
            resolution: "30p".into(),
            led_far: true,
            led_near: true,
            led_far_intensity: 15,
            led_near_intensity: 16,
            flashlight: false,
            strobe: false,
            ex_light_filter: true,
            selfie: false,
            exposure_us: 100,
            auto_exposure: true,
            gain: 1,
            denoise: true,
            denoise_edge: 0x23,
            denoise_color: 0x44,
        }
    }
}

impl IrSettings {
    /// Registre 0x0010 : groupes de LED, lampe torche, stroboscope.
    fn led_state(&self) -> u8 {
        let mut v = match (self.led_far, self.led_near) {
            (true, true) => 0b000000,
            (true, false) => 0b100000,
            (false, true) => 0b010000,
            (false, false) => 0b110000,
        };
        if self.flashlight {
            v |= 0b01;
        }
        if self.strobe {
            v |= 0b1000_0000;
        }
        v
    }

    fn ex_filter_reg(&self) -> u8 {
        if self.ex_light_filter {
            0x03
        } else {
            0x00
        }
    }

    fn buffer_update(&self) -> u8 {
        if self.resolution == "30p" {
            0x2D
        } else {
            0x32
        }
    }
}

#[derive(Clone, Serialize)]
pub struct IrFrame {
    pub side: Side,
    pub frame_number: u32,
    pub width: usize,
    pub height: usize,
    pub pixels_b64: String,
}

/// Compteurs de diagnostic, présents uniquement dans les tests.
#[cfg(test)]
#[derive(Default, Clone, Debug)]
pub struct IrStats {
    pub by_b49: std::collections::BTreeMap<u8, u32>,
    pub in_order: u32,
    pub repeats: u32,
    pub out_of_order: u32,
    pub gap_ms_sum: f64,
    pub gap_n: u32,
    pub last_at: Option<Instant>,
}

pub struct IrState {
    #[cfg(test)]
    pub stats: IrStats,
    settings: IrSettings,
    width: usize,
    height: usize,
    max_frags: usize,
    buf: Vec<u8>,
    received: Vec<bool>,
    prev_frag: usize,
    frame_counter: u32,
    exposure: u32,
    ae_last: Instant,
    ae_pending: Option<u32>,
}

impl IrState {
    fn received_count(&self) -> usize {
        self.received.iter().filter(|&&r| r).count()
    }
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

// --- Paquets MCU --------------------------------------------------------------------

/// Rapport 0x01 / sous-commande 0x21 (écriture MCU), CRC posé en dernier octet.
fn mcu_packet(core: &mut Core, body: &[u8]) -> [u8; 49] {
    let mut pkt = [0u8; 49];
    pkt[0] = 0x01;
    pkt[1] = core.next_counter();
    pkt[2..10].copy_from_slice(&core.rumble_bytes());
    pkt[10] = 0x21;
    pkt[11..11 + body.len()].copy_from_slice(body);
    pkt[48] = crc8(&pkt[12..48]);
    pkt
}

/// Rapport 0x11 « demande d'état MCU » (octet 10 = 0x01).
fn status_request(core: &mut Core) {
    let mut pkt = [0u8; 49];
    pkt[0] = 0x11;
    pkt[1] = core.next_counter();
    pkt[2..10].copy_from_slice(&core.rumble_bytes());
    pkt[10] = 0x01;
    let _ = core.write_raw(&pkt);
}

/// Écrit jusqu'à 8 registres (adresse 16 bits, valeur) puis finalise la configuration.
fn write_registers(core: &mut Core, regs: &[(u16, u8)]) {
    let regs = &regs[..regs.len().min(8)];
    let mut body = vec![0x23, 0x04, regs.len() as u8 + 1];
    for &(addr, val) in regs {
        body.extend_from_slice(&[(addr >> 8) as u8, addr as u8, val]);
    }
    body.extend_from_slice(&[0x00, 0x07, 0x01]); // 0x0007 = 1 : sans cela, rien ne prend effet
    let pkt = mcu_packet(core, &body);
    let _ = core.write_raw(&pkt);
}

fn lighting_regs(s: &IrSettings) -> Vec<(u16, u8)> {
    vec![
        (0x0010, s.led_state()),
        (0x0011, s.led_far_intensity),
        (0x0012, s.led_near_intensity),
        (0x000E, s.ex_filter_reg()),
        (0x002D, if s.selfie { 0x02 } else { 0x00 }),
        (0x0167, s.denoise as u8),
        (0x0168, s.denoise_edge),
        (0x0169, s.denoise_color),
    ]
}

fn exposure_raw(us: u32) -> u32 {
    us.clamp(10, 600) * 31200 / 1000
}

fn set_exposure_gain(core: &mut Core, us: u32, gain: u8) {
    let raw = exposure_raw(us);
    let g = gain.clamp(1, 16);
    write_registers(
        core,
        &[
            (0x0130, raw as u8),
            (0x0131, (raw >> 8) as u8),
            (0x012E, (g & 0x0F) << 4),
            (0x012F, (g & 0xF0) >> 4),
        ],
    );
}

fn wait_reply(core: &mut Core, ms: u64) -> Option<Vec<u8>> {
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_millis(ms) {
        if let Some(raw) = core.read_report(30) {
            if raw[0] == 0x21 {
                return Some(raw);
            }
        }
    }
    None
}

/// Attend un rapport 0x31 où `raw[49] == 0x01` et `raw[56] == mcu_state`.
fn wait_mcu_state(core: &mut Core, mcu_state: u8) -> bool {
    for _ in 0..25 {
        status_request(core);
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_millis(80) {
            if let Some(raw) = core.read_report(30) {
                if raw.len() >= 57 && raw[0] == 0x31 && raw[49] == 0x01 && raw[56] == mcu_state {
                    return true;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// Accusé de fragment (rapport 0x11). `ack_frag < 0` = « envoie le suivant ».
fn send_ack(core: &mut Core, ack_frag: i32, is_empty: bool, b49: u8) {
    let mut pkt = [0u8; 49];
    pkt[0] = 0x11;
    pkt[1] = core.next_counter();
    pkt[10] = 0x03;
    if is_empty && b49 == 0x00 {
        pkt[12] = 0x01;
        pkt[13] = (ack_frag + 1) as u8;
    } else {
        pkt[14] = ack_frag as u8;
    }
    pkt[47] = crc8(&pkt[11..47]);
    pkt[48] = 0xFF;
    let _ = core.write_raw(&pkt);
}

// --- Cycle de vie ---------------------------------------------------------------------

/// Négociation complète avec le MCU, puis démarrage du flux d'images.
pub fn start(core: &mut Core, settings: &IrSettings) -> Result<(), String> {
    if core.side != Side::Right {
        return Err("ir_needs_right".into());
    }
    if core.ir.is_some() {
        stop(core);
    }
    let (res_reg, max_frag, width, height) = mode_of(&settings.resolution);

    core.subcommand(0x03, &[0x31], 800); // mode de rapport 0x31 (avec données MCU)
    core.subcommand(0x22, &[0x01], 800); // MCU allumé
    if !wait_mcu_state(core, 0x01) {
        return Err("ir_mcu_standby".into());
    }

    // MCU → mode IR
    let pkt = mcu_packet(core, &[0x21, 0x00, 0x05]);
    let _ = core.write_raw(&pkt);
    wait_reply(core, 150);
    if !wait_mcu_state(core, 0x05) {
        return Err("ir_mcu_mode".into());
    }

    // Mode IR : transfert d'image
    let pkt = mcu_packet(core, &[0x23, 0x01, 0x07, max_frag, 0x00, 0x05, 0x00, 0x18]);
    let _ = core.write_raw(&pkt);
    wait_reply(core, 150);

    // Registres, première partie : résolution, exposition, LED, gain, filtre externe.
    let raw_exp = exposure_raw(settings.exposure_us);
    let g = settings.gain.clamp(1, 16);
    let mut body = vec![0x23, 0x04, 0x09];
    for &(bank, addr, val) in &[
        (0x00u8, 0x2Eu8, res_reg),
        (0x01, 0x30, raw_exp as u8),
        (0x01, 0x31, (raw_exp >> 8) as u8),
        (0x01, 0x32, 0x00),
        (0x00, 0x10, settings.led_state()),
        (0x01, 0x2E, (g & 0x0F) << 4),
        (0x01, 0x2F, (g & 0xF0) >> 4),
        (0x00, 0x0E, settings.ex_filter_reg()),
        (0x01, 0x43, 0xC8),
    ] {
        body.extend_from_slice(&[bank, addr, val]);
    }
    let pkt = mcu_packet(core, &body);
    let _ = core.write_raw(&pkt);

    // Demande d'état IR avant d'attendre l'accusé.
    let mut st = [0u8; 49];
    st[0] = 0x11;
    st[1] = core.next_counter();
    st[2..10].copy_from_slice(&core.rumble_bytes());
    st[10] = 0x03;
    st[11] = 0x02;
    st[47] = crc8(&st[11..47]);
    st[48] = 0xFF;
    let _ = core.write_raw(&st);
    wait_reply(core, 150);

    // Registres, seconde partie : intensités, retournement, réduction du bruit, finalisation.
    let regs = [
        (0x0011u16, settings.led_far_intensity),
        (0x0012, settings.led_near_intensity),
        (0x002D, if settings.selfie { 2 } else { 0 }),
        (0x0167, settings.denoise as u8),
        (0x0168, settings.denoise_edge),
        (0x0169, settings.denoise_color),
        (0x0004, settings.buffer_update()),
    ];
    write_registers(core, &regs);
    wait_reply(core, 150);

    let max_frags = max_frag as usize + 1;
    core.ir = Some(IrState {
        #[cfg(test)]
        stats: IrStats::default(),
        settings: settings.clone(),
        width,
        height,
        max_frags,
        buf: vec![0; width * height],
        received: vec![false; max_frags],
        // Partir du dernier fragment : le premier fragment 0 du flux est alors « attendu ».
        prev_frag: max_frags - 1,
        frame_counter: 0,
        exposure: settings.exposure_us,
        ae_last: Instant::now(),
        ae_pending: None,
    });
    send_ack(core, 0, false, 0xFF);
    Ok(())
}

/// Coupe le MCU et rend la manette au mode standard.
pub fn stop(core: &mut Core) {
    core.ir = None;
    core.subcommand(0x22, &[0x00], 600);
    core.subcommand(0x03, &[0x30], 600);
}

/// Applique de nouveaux réglages à chaud (relance complète si la résolution change).
pub fn apply(core: &mut Core, new: &IrSettings) -> Result<(), String> {
    let Some(st) = core.ir.as_mut() else {
        return Ok(());
    };
    let old = st.settings.clone();
    if old == *new {
        return Ok(());
    }
    if old.resolution != new.resolution {
        return start(core, new);
    }
    st.settings = new.clone();
    st.exposure = new.exposure_us;
    st.ae_pending = None;

    let lighting_changed = old.led_far != new.led_far
        || old.led_near != new.led_near
        || old.led_far_intensity != new.led_far_intensity
        || old.led_near_intensity != new.led_near_intensity
        || old.flashlight != new.flashlight
        || old.strobe != new.strobe
        || old.ex_light_filter != new.ex_light_filter
        || old.selfie != new.selfie
        || old.denoise != new.denoise
        || old.denoise_edge != new.denoise_edge
        || old.denoise_color != new.denoise_color;
    if lighting_changed {
        write_registers(core, &lighting_regs(new));
        std::thread::sleep(Duration::from_millis(15)); // sinon un paquet est perdu
    }
    if old.exposure_us != new.exposure_us || old.gain != new.gain {
        set_exposure_gain(core, new.exposure_us, new.gain);
    }
    Ok(())
}

/// Écrit un registre arbitraire du capteur (mode avancé).
pub fn write_register(core: &mut Core, addr: u16, val: u8) -> Result<(), String> {
    if core.ir.is_none() {
        return Err("ir_inactive".into());
    }
    write_registers(core, &[(addr, val)]);
    Ok(())
}

/// Appelé à chaque tour de boucle : applique une correction d'exposition en attente.
pub fn maintenance(core: &mut Core) {
    let Some(st) = core.ir.as_mut() else { return };
    if let Some(us) = st.ae_pending.take() {
        let gain = st.settings.gain;
        set_exposure_gain(core, us, gain);
    }
}

// --- Réception des fragments ----------------------------------------------------------

/// Traite un rapport 0x31 : accuse réception **d'abord**, range les données ensuite.
pub fn on_packet(core: &mut Core, raw: &[u8]) {
    let (prev, max) = match core.ir.as_ref() {
        Some(st) => (st.prev_frag, st.max_frags),
        None => return,
    };
    let b49 = raw[49];
    #[cfg(test)]
    if let Some(st) = core.ir.as_mut() {
        *st.stats.by_b49.entry(b49).or_default() += 1;
        let now = Instant::now();
        if let Some(t) = st.stats.last_at {
            st.stats.gap_ms_sum += now.duration_since(t).as_secs_f64() * 1000.0;
            st.stats.gap_n += 1;
        }
        st.stats.last_at = Some(now);
    }

    if b49 != 0x03 || raw.len() < 60 {
        // Rapport vide : on accuse à nouveau, sinon le MCU passe en mode lent (30 ms/fragment).
        send_ack(core, prev as i32, true, b49);
        return;
    }
    let got = raw[52] as usize;

    #[cfg(test)]
    if let Some(st) = core.ir.as_mut() {
        if got == (prev + 1) % max {
            st.stats.in_order += 1;
        } else if got == prev {
            st.stats.repeats += 1;
        } else {
            st.stats.out_of_order += 1;
        }
    }

    let store = if got == (prev + 1) % max {
        send_ack(core, got as i32, false, 0xFF);
        true
    } else if got == prev {
        send_ack(core, got as i32, false, 0xFF);
        false
    } else {
        // Fragment manqué ou hors ordre : on garde ses données, on accuse.
        send_ack(core, got as i32, false, 0xFF);
        true
    };

    if let Some(st) = core.ir.as_mut() {
        if store || got != prev {
            st.prev_frag = got;
        }
    }
    if !store {
        return;
    }
    let chunk = raw[59..].get(..FRAG_LEN);
    let Some(chunk) = chunk else { return };
    let side = core.side;
    let frame = core
        .ir
        .as_mut()
        .and_then(|st| store_fragment(st, side, got, chunk, raw));
    if let Some(f) = frame {
        core.emit(Event::Ir(f));
    }
}

fn store_fragment(
    st: &mut IrState,
    side: Side,
    frag: usize,
    chunk: &[u8],
    raw: &[u8],
) -> Option<IrFrame> {
    let offset = frag * FRAG_LEN;
    if offset + FRAG_LEN > st.buf.len() {
        return None;
    }
    let mut out = None;
    // Le fragment 0 annonce une nouvelle image. À 30p le lien porte ~66 fragments/s
    // pour ~120 produits : le MCU sacrifie souvent le dernier. Publier l'image sortante
    // ici (plutôt que d'attendre un fragment qui ne viendra pas) donne un flux vivant.
    if frag == 0 && st.received_count() >= 2 {
        out = Some(commit(st, side, raw));
    }
    st.buf[offset..offset + FRAG_LEN].copy_from_slice(chunk);
    st.received[frag] = true;
    if st.received_count() >= st.max_frags {
        out = Some(commit(st, side, raw));
    }
    out
}

fn commit(st: &mut IrState, side: Side, raw: &[u8]) -> IrFrame {
    st.frame_counter += 1;
    st.received.iter_mut().for_each(|r| *r = false);
    auto_exposure(st, raw);
    IrFrame {
        side,
        frame_number: st.frame_counter,
        width: st.width,
        height: st.height,
        pixels_b64: b64(&st.buf),
    }
}

/// Garde l'image correctement exposée grâce aux statistiques du MCU
/// (`raw[53]` = intensité moyenne, `raw[55..57]` = pixels saturés). Au plus 2 fois par seconde.
fn auto_exposure(st: &mut IrState, raw: &[u8]) {
    if !st.settings.auto_exposure
        || raw.len() < 57
        || st.ae_last.elapsed() < Duration::from_millis(500)
    {
        return;
    }
    st.ae_last = Instant::now();
    let avg = raw[53];
    let white = raw[55] as u32 | (raw[56] as u32) << 8;
    let white_pct = white as f32 * 100.0 / (st.width * st.height).max(1) as f32;

    let e = st.exposure;
    let next = if white_pct > 25.0 || avg > 235 {
        (e * 3 / 4).max(20)
    } else if white_pct < 1.0 || avg < 20 {
        // Plafond à 250 µs : au-delà, la cadence chute sans gain de lumière utile.
        (e * 14 / 10 + 15).min(250)
    } else {
        return;
    };
    if next != e {
        st.exposure = next;
        st.ae_pending = Some(next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn led_state_bits() {
        let mut s = IrSettings::default();
        assert_eq!(s.led_state(), 0);
        s.led_far = false;
        assert_eq!(s.led_state(), 0b010000);
        s.led_near = false;
        s.strobe = true;
        assert_eq!(s.led_state(), 0b1011_0000);
    }

    #[test]
    fn exposure_conversion() {
        assert_eq!(exposure_raw(100), 3120);
        assert_eq!(exposure_raw(1000), 600 * 31200 / 1000);
    }

    #[test]
    fn modes_cover_all_resolutions() {
        assert_eq!(mode_of("30p"), (0x69, 0x03, 40, 30));
        assert_eq!(mode_of("240p").3, 240);
        assert_eq!(mode_of("inconnue").2, 40);
    }
}
