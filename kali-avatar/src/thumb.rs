//! Small PNG thumbnails of captures, built with gdk-pixbuf (already linked by GTK).

use base64::Engine;
use gtk4::gdk_pixbuf::{InterpType, PixbufLoader};
use gtk4::prelude::*;

/// Longest side of the thumbnail in pixels: enough to recognise the capture, a few KB on the wire.
pub const MAX_SIDE: i32 = 200;

/// `data:image/png;base64,...` for a PNG, scaled so its longest side is at most `max`.
pub fn data_url(png: &[u8], max: i32) -> Option<String> {
    let loader = PixbufLoader::new();
    loader.write(png).ok()?;
    loader.close().ok()?;
    let pixbuf = loader.pixbuf()?;
    let (w, h) = (pixbuf.width(), pixbuf.height());
    if w <= 0 || h <= 0 {
        return None;
    }
    let scale = (max as f64 / w.max(h) as f64).min(1.0);
    let (nw, nh) = (((w as f64 * scale).round() as i32).max(1), ((h as f64 * scale).round() as i32).max(1));
    let small = pixbuf.scale_simple(nw, nh, InterpType::Bilinear)?;
    let bytes = small.save_to_bufferv("png", &[]).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use gtk4::gdk_pixbuf::{Colorspace, Pixbuf};

    fn png(w: i32, h: i32) -> Vec<u8> {
        let pb = Pixbuf::new(Colorspace::Rgb, false, 8, w, h).unwrap();
        pb.fill(0x3366ccff);
        pb.save_to_bufferv("png", &[]).unwrap()
    }

    fn decode(url: &str) -> (i32, i32) {
        let b64 = url.strip_prefix("data:image/png;base64,").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let loader = PixbufLoader::new();
        loader.write(&bytes).unwrap();
        loader.close().unwrap();
        let pb = loader.pixbuf().unwrap();
        (pb.width(), pb.height())
    }

    #[test]
    fn scales_the_longest_side_and_keeps_the_ratio() {
        assert_eq!(decode(&data_url(&png(1920, 1080), 200).unwrap()), (200, 113));
        assert_eq!(decode(&data_url(&png(600, 1200), 200).unwrap()), (100, 200));
    }

    #[test]
    fn never_enlarges_and_rejects_garbage() {
        assert_eq!(decode(&data_url(&png(64, 32), 200).unwrap()), (64, 32));
        assert!(data_url(b"not a png", 200).is_none());
        assert!(data_url(&[], 200).is_none());
    }
}
