//! Protocole Joy-Con : constantes, codages et décodages purs, sans entrées/sorties.
//! Références : la documentation de dekuNukem (rapports HID, sous-commandes) et
//! jc_toolkit de CTCaer (SPI, MCU, caméra IR).

use serde::{Deserialize, Serialize};

pub const VID_NINTENDO: u16 = 0x057E;
pub const PID_JOYCON_L: u16 = 0x2006;
pub const PID_JOYCON_R: u16 = 0x2007;

/// Côté d'un Joy-Con. Les autres manettes ne sont pas personnalisables ici.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

impl Side {
    pub fn from_pid(pid: u16) -> Option<Side> {
        match pid {
            PID_JOYCON_L => Some(Side::Left),
            PID_JOYCON_R => Some(Side::Right),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }
}

// --- Mémoire SPI -----------------------------------------------------------------

/// Taille maximale d'une lecture/écriture SPI par sous-commande.
pub const SPI_CHUNK: usize = 0x1D;
pub const SPI_SIZE: usize = 512 * 1024;

pub const SPI_SERIAL: u32 = 0x6000;
pub const SPI_FACTORY_CAL_L: u32 = 0x603D;
pub const SPI_FACTORY_CAL_R: u32 = 0x6046;
pub const SPI_COLORS: u32 = 0x6050;
pub const SPI_USER_CAL: u32 = 0x8010;
/// Le bloc utilisateur du stick droit commence 11 octets après celui du gauche.
pub const SPI_USER_CAL_R_OFFSET: u32 = 0x0B;

/// Zones que l'application a le droit d'écrire. Tout le reste de la puce est en
/// lecture seule : une adresse erronée ne peut donc jamais atteindre la calibration
/// d'usine, le numéro de série ou le firmware.
pub const WRITABLE: &[(u32, u32)] = &[
    (SPI_COLORS, SPI_COLORS + 12),
    (SPI_USER_CAL, SPI_USER_CAL + 24),
];

pub fn is_writable(addr: u32, len: usize) -> bool {
    let end = addr + len as u32;
    WRITABLE.iter().any(|&(a, b)| addr >= a && end <= b)
}

/// Zones sauvegardées avant chaque écriture (un peu plus larges que `WRITABLE`
/// pour garder le contexte : série, calibrations d'usine).
pub const BACKUP_REGIONS: &[(u32, usize)] = &[(0x6000, 0x100), (0x8000, 0x40)];

// --- Couleurs ---------------------------------------------------------------------

pub type Rgb = [u8; 3];

pub fn hex_of(c: Rgb) -> String {
    format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2])
}

pub fn parse_hex(s: &str) -> Result<Rgb, String> {
    let h = s.trim().trim_start_matches('#');
    if h.len() != 6 || !h.is_ascii() {
        return Err(format!("couleur invalide : « {s} »"));
    }
    let v = u32::from_str_radix(h, 16).map_err(|_| format!("couleur invalide : « {s} »"))?;
    Ok([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

/// Bloc couleurs de la SPI (12 octets à 0x6050) : coque, boutons, puis les deux
/// poignées (utiles seulement à la manette Pro, conservées telles quelles).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColorBlock {
    pub body: Rgb,
    pub buttons: Rgb,
    pub grips: [u8; 6],
}

impl ColorBlock {
    pub fn decode(b: &[u8]) -> Option<ColorBlock> {
        if b.len() < 12 {
            return None;
        }
        Some(ColorBlock {
            body: [b[0], b[1], b[2]],
            buttons: [b[3], b[4], b[5]],
            grips: [b[6], b[7], b[8], b[9], b[10], b[11]],
        })
    }
    pub fn encode(&self) -> [u8; 12] {
        let mut o = [0u8; 12];
        o[0..3].copy_from_slice(&self.body);
        o[3..6].copy_from_slice(&self.buttons);
        o[6..12].copy_from_slice(&self.grips);
        o
    }
}

// --- Calibration des sticks -------------------------------------------------------

/// Calibration d'un stick, en valeurs brutes 12 bits. `above`/`below` sont des
/// distances au centre (et non des positions absolues), comme dans la SPI.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StickCal {
    pub center: [u16; 2],
    pub above: [u16; 2],
    pub below: [u16; 2],
}

fn unpack_pair(b: &[u8]) -> [u16; 2] {
    [
        (((b[1] as u16) << 8) & 0xF00) | b[0] as u16,
        ((b[2] as u16) << 4) | (b[1] as u16 >> 4),
    ]
}

fn pack_pair(v: [u16; 2]) -> [u8; 3] {
    [
        (v[0] & 0xFF) as u8,
        (((v[0] >> 8) & 0x0F) | ((v[1] & 0x0F) << 4)) as u8,
        ((v[1] >> 4) & 0xFF) as u8,
    ]
}

impl StickCal {
    /// Décode un bloc de 9 octets. Gauche : (au-dessus, centre, en-dessous) ;
    /// droit : (centre, en-dessous, au-dessus).
    pub fn decode(b: &[u8], side: Side) -> Option<StickCal> {
        if b.len() < 9 {
            return None;
        }
        let (p0, p1, p2) = (
            unpack_pair(&b[0..3]),
            unpack_pair(&b[3..6]),
            unpack_pair(&b[6..9]),
        );
        Some(match side {
            Side::Left => StickCal {
                above: p0,
                center: p1,
                below: p2,
            },
            Side::Right => StickCal {
                center: p0,
                below: p1,
                above: p2,
            },
        })
    }

    pub fn encode(&self, side: Side) -> [u8; 9] {
        let (a, c, b) = (
            pack_pair(self.above),
            pack_pair(self.center),
            pack_pair(self.below),
        );
        let order = match side {
            Side::Left => [a, c, b],
            Side::Right => [c, b, a],
        };
        let mut o = [0u8; 9];
        for (i, p) in order.iter().enumerate() {
            o[i * 3..i * 3 + 3].copy_from_slice(p);
        }
        o
    }

    /// Une calibration est plausible si tout est dans l'échelle 12 bits et les
    /// distances ne sont ni nulles ni absurdes. Évite d'écrire un bloc qui rendrait
    /// le stick inutilisable.
    pub fn is_sane(&self) -> bool {
        let in_range = |v: u16, lo: u16, hi: u16| (lo..=hi).contains(&v);
        self.center.iter().all(|&c| in_range(c, 1200, 2900))
            && self
                .above
                .iter()
                .chain(self.below.iter())
                .all(|&d| in_range(d, 400, 2000))
    }

    /// Position brute → [-1, 1]. Sans zone morte : l'écran montre le brut calibré,
    /// ce qui est précisément ce qu'on veut voir pour juger un drift.
    pub fn normalize(&self, raw: [u16; 2]) -> [f32; 2] {
        let mut o = [0f32; 2];
        for i in 0..2 {
            let d = raw[i] as f32 - self.center[i] as f32;
            let span = if d >= 0.0 {
                self.above[i]
            } else {
                self.below[i]
            }
            .max(150) as f32;
            o[i] = (d / span).clamp(-1.0, 1.0);
        }
        o
    }

    /// Calibration de repli quand la puce ne donne rien d'exploitable.
    pub fn fallback() -> StickCal {
        StickCal {
            center: [2048, 2048],
            above: [1400, 1400],
            below: [1400, 1400],
        }
    }
}

// --- Rapports d'entrée standard (0x30 / 0x21 / 0x31) -----------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BatteryLevel {
    Empty,
    Critical,
    Low,
    Medium,
    Full,
}

#[derive(Clone, Debug, Serialize)]
pub struct Battery {
    pub level: BatteryLevel,
    pub charging: bool,
}

#[derive(Copy, Clone, Debug, Serialize)]
pub struct StickState {
    pub x: f32,
    pub y: f32,
    pub raw_x: u16,
    pub raw_y: u16,
}

#[derive(Clone, Debug, Serialize)]
pub struct Telemetry {
    pub side: Side,
    /// Boutons actuellement enfoncés, par identifiant stable (voir `buttons_of`).
    pub pressed: Vec<&'static str>,
    pub stick: StickState,
    pub battery: Battery,
    /// Accélération en g (moyenne des 3 échantillons du rapport).
    pub accel: [f32; 3],
    /// Vitesse angulaire en °/s.
    pub gyro: [f32; 3],
}

pub fn battery_of(byte2: u8) -> Battery {
    let level = match (byte2 & 0xE0) >> 4 {
        8..=10 => BatteryLevel::Full,
        6 | 7 => BatteryLevel::Medium,
        4 | 5 => BatteryLevel::Low,
        2 | 3 => BatteryLevel::Critical,
        _ => BatteryLevel::Empty,
    };
    Battery {
        level,
        charging: byte2 & 0x10 != 0,
    }
}

/// Identifiants de boutons communs avec le front : `up down left right minus capture
/// l zl sl sr stick` à gauche, `a b x y plus home r zr sl sr stick` à droite.
pub fn buttons_of(side: Side, raw: &[u8]) -> Vec<&'static str> {
    let (right, shared, left) = (raw[3], raw[4], raw[5]);
    let table: &[(u8, u8, &'static str)] = match side {
        // (octet : 0 = droite, 1 = partagé, 2 = gauche, masque, nom)
        Side::Left => &[
            (2, 0x01, "down"),
            (2, 0x02, "up"),
            (2, 0x04, "right"),
            (2, 0x08, "left"),
            (2, 0x10, "sr"),
            (2, 0x20, "sl"),
            (2, 0x40, "l"),
            (2, 0x80, "zl"),
            (1, 0x01, "minus"),
            (1, 0x08, "stick"),
            (1, 0x20, "capture"),
        ],
        Side::Right => &[
            (0, 0x01, "y"),
            (0, 0x02, "x"),
            (0, 0x04, "b"),
            (0, 0x08, "a"),
            (0, 0x10, "sr"),
            (0, 0x20, "sl"),
            (0, 0x40, "r"),
            (0, 0x80, "zr"),
            (1, 0x02, "plus"),
            (1, 0x04, "stick"),
            (1, 0x10, "home"),
        ],
    };
    table
        .iter()
        .filter(|&&(byte, mask, _)| {
            let v = match byte {
                0 => right,
                1 => shared,
                _ => left,
            };
            v & mask != 0
        })
        .map(|&(_, _, name)| name)
        .collect()
}

fn i16_at(raw: &[u8], i: usize) -> i16 {
    i16::from_le_bytes([raw[i], raw[i + 1]])
}

/// Décode un rapport d'entrée standard. `cal` normalise le stick du côté concerné.
pub fn parse_standard(side: Side, raw: &[u8], cal: &StickCal) -> Option<Telemetry> {
    if raw.len() < 12 {
        return None;
    }
    let (rx, ry) = match side {
        Side::Left => (
            raw[6] as u16 | ((raw[7] as u16 & 0x0F) << 8),
            (raw[7] as u16 >> 4) | ((raw[8] as u16) << 4),
        ),
        Side::Right => (
            raw[9] as u16 | ((raw[10] as u16 & 0x0F) << 8),
            (raw[10] as u16 >> 4) | ((raw[11] as u16) << 4),
        ),
    };
    let [x, y] = cal.normalize([rx, ry]);

    let (mut accel, mut gyro) = ([0f32; 3], [0f32; 3]);
    if raw.len() >= 49 {
        for s in 0..3 {
            let o = 13 + s * 12;
            for a in 0..3 {
                accel[a] += i16_at(raw, o + a * 2) as f32 * 0.000244 / 3.0;
                gyro[a] += i16_at(raw, o + 6 + a * 2) as f32 * 0.061 / 3.0;
            }
        }
    }

    Some(Telemetry {
        side,
        pressed: buttons_of(side, raw),
        stick: StickState {
            x,
            y,
            raw_x: rx,
            raw_y: ry,
        },
        battery: battery_of(raw[2]),
        accel,
        gyro,
    })
}

// --- CRC-8 du MCU -------------------------------------------------------------------

/// CRC-8 (polynôme 0x07) des paquets MCU.
pub fn crc8(data: &[u8]) -> u8 {
    let mut crc = 0u8;
    for &b in data {
        crc ^= b;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                (crc << 1) ^ 0x07
            } else {
                crc << 1
            };
        }
    }
    crc
}

// --- Vibration HD -------------------------------------------------------------------

pub const RUMBLE_NEUTRAL: [u8; 8] = [0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40];

/// Encode (basse fréquence, haute fréquence, amplitude 0..1) en 4 octets de vibration.
pub fn encode_rumble(freq_low: f32, freq_high: f32, amp: f32) -> [u8; 4] {
    if amp <= 0.01 {
        return [0x00, 0x01, 0x40, 0x40];
    }
    let amp = amp.clamp(0.0, 1.0);
    let fh = freq_high.clamp(82.0, 1252.0);
    let fl = freq_low.clamp(41.0, 626.0);

    let hf = ((((fh / 10.0).log2() * 32.0).round() as i32) - 0x60) * 4;
    let lf = (((fl / 10.0).log2() * 32.0).round() as i32) - 0x40;

    let amp_enc = if amp > 0.23 {
        ((amp * 8.7).log2() * 32.0).round() as i32
    } else if amp > 0.12 {
        ((amp * 17.0).log2() * 16.0).round() as i32
    } else {
        (amp * 16.0 / 0.12).round() as i32
    };
    let hf_amp = amp_enc * 2;
    let lf_amp = amp_enc / 2 + 64;

    [
        (hf & 0xFF) as u8,
        ((hf_amp + ((hf >> 8) & 0xFF)) & 0xFF) as u8,
        ((lf + ((lf_amp >> 8) & 0xFF)) & 0xFF) as u8,
        (lf_amp & 0xFF) as u8,
    ]
}

// --- Lumière du bouton HOME (sous-commande 0x38) -----------------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HomeMode {
    Breathe,
    Heartbeat,
    Solid,
    Off,
}

/// Construit les 25 octets de la sous-commande 0x38 : un motif de « mini-cycles »
/// (intensité, durée de fondu, durée de maintien), joué en boucle.
pub fn home_light_pattern(mode: HomeMode, intensity: u8) -> [u8; 25] {
    let i = intensity.min(15);
    // (intensité, fondu, maintien) par mini-cycle
    let cycles: Vec<(u8, u8, u8)> = match mode {
        HomeMode::Off => vec![(0, 0, 0xF)],
        HomeMode::Solid => vec![(i, 0, 0xF)],
        HomeMode::Breathe => vec![(i, 0xF, 0x2), (0, 0xF, 0x2)],
        HomeMode::Heartbeat => vec![(i, 0x1, 0x1), (0, 0x1, 0x1), (i, 0x1, 0x1), (0, 0x1, 0xF)],
    };
    let mut p = [0u8; 25];
    p[0] = ((cycles.len() as u8) << 4) | 0x1; // nombre de mini-cycles, durée de base
    p[1] = if mode == HomeMode::Solid { i << 4 } else { 0 }; // départ ; 0 cycle complet = boucle infinie
    for (n, &(inten, fade, hold)) in cycles.iter().enumerate() {
        let base = 2 + (n / 2) * 3;
        if n % 2 == 0 {
            p[base] |= inten << 4;
            p[base + 1] |= (fade << 4) | hold;
        } else {
            p[base] |= inten;
            p[base + 2] |= (fade << 4) | hold;
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        assert_eq!(parse_hex("#0AB9E6").unwrap(), [0x0A, 0xB9, 0xE6]);
        assert_eq!(hex_of([0x0A, 0xB9, 0xE6]), "#0AB9E6");
        assert!(parse_hex("#12345").is_err());
        assert!(parse_hex("zzzzzz").is_err());
    }

    #[test]
    fn color_block_keeps_grips() {
        let raw = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let mut b = ColorBlock::decode(&raw).unwrap();
        b.body = [9, 9, 9];
        assert_eq!(&b.encode()[6..], &raw[6..]);
    }

    #[test]
    fn stick_cal_roundtrip_both_sides() {
        let cal = StickCal {
            center: [2100, 1980],
            above: [1180, 1210],
            below: [1100, 1150],
        };
        for side in [Side::Left, Side::Right] {
            assert_eq!(StickCal::decode(&cal.encode(side), side).unwrap(), cal);
        }
    }

    #[test]
    fn stick_cal_uses_distances_not_positions() {
        let cal = StickCal {
            center: [2048, 2048],
            above: [1200, 1200],
            below: [1000, 1000],
        };
        assert_eq!(cal.normalize([2048, 2048]), [0.0, 0.0]);
        assert_eq!(cal.normalize([3248, 2048])[0], 1.0);
        assert_eq!(cal.normalize([1048, 2048])[0], -1.0);
        // Positions absolues prises pour des distances : pleine course à ~0,34 seulement.
        let wrong = StickCal {
            center: [2048, 2048],
            above: [3500, 3500],
            below: [600, 600],
        };
        assert!(wrong.normalize([3248, 2048])[0] < 0.5);
        assert!(!wrong.is_sane());
        assert!(cal.is_sane());
    }

    #[test]
    fn writable_whitelist() {
        assert!(is_writable(SPI_COLORS, 12));
        assert!(is_writable(SPI_USER_CAL, 11));
        assert!(is_writable(SPI_USER_CAL + 11, 11));
        assert!(!is_writable(SPI_SERIAL, 16));
        assert!(!is_writable(SPI_FACTORY_CAL_L, 9));
        assert!(!is_writable(SPI_COLORS, 13));
        assert!(!is_writable(0x5FFF, 4));
    }

    #[test]
    fn crc8_known_vector() {
        // CRC-8/SMBUS de « 123456789 » = 0xF4.
        assert_eq!(crc8(b"123456789"), 0xF4);
    }

    #[test]
    fn rumble_off_is_neutral() {
        assert_eq!(encode_rumble(160.0, 320.0, 0.0), [0x00, 0x01, 0x40, 0x40]);
        assert_ne!(encode_rumble(160.0, 320.0, 0.6), [0x00, 0x01, 0x40, 0x40]);
    }

    #[test]
    fn home_light_pattern_shapes() {
        assert_eq!(home_light_pattern(HomeMode::Off, 15)[0] >> 4, 1);
        assert_eq!(home_light_pattern(HomeMode::Solid, 9)[1] >> 4, 9);
        assert_eq!(home_light_pattern(HomeMode::Heartbeat, 15)[0] >> 4, 4);
    }

    #[test]
    fn standard_report_decodes_left_buttons_and_stick() {
        let mut raw = [0u8; 49];
        raw[0] = 0x30;
        raw[2] = 0x80 | 0x10; // pleine, en charge
        raw[5] = 0x02 | 0x40; // haut + L
        raw[4] = 0x20; // capture
        raw[7] = 0x08; // x = 0x800
        raw[8] = 0x80; // y = 0x800
        let t = parse_standard(Side::Left, &raw, &StickCal::fallback()).unwrap();
        assert_eq!(t.pressed, vec!["up", "l", "capture"]);
        assert_eq!((t.stick.raw_x, t.stick.raw_y), (2048, 2048));
        assert!(t.battery.charging);
        assert_eq!(t.battery.level, BatteryLevel::Full);
    }
}
