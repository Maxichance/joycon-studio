# Third-Party Notices

## CTCaer / jc_toolkit

- Upstream: https://github.com/CTCaer/jc_toolkit
- Licence: MIT, Copyright (c) 2018 CTCaer

Used as the reference for the SPI memory map and the infrared camera exchange. The 256-entry Ironbow palette in `src/lib/ironbow.ts` comes from that project. The register values and the fragment acknowledgement sequence in `src-tauri/src/ir.rs` follow it and were checked against it.

```
MIT License

Copyright (c) CTCaer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## dekuNukem / Nintendo_Switch_Reverse_Engineering

- Upstream: https://github.com/dekuNukem/Nintendo_Switch_Reverse_Engineering
- Licence: MIT

Documentation reference only. The HID report layouts and subcommands it documents are reimplemented in `src-tauri/src/protocol.rs`. No code from this project is included.

## Libraries

The app is built with Tauri, hidapi (Rust bindings), React, Zustand, three.js and Vite, each under its own permissive licence (MIT or Apache-2.0). Their licence texts ship with their packages.

## Fonts

Archivo (Copyright The Archivo Project Authors), IBM Plex Sans and IBM Plex Mono (Copyright IBM Corp.) are bundled through the `@fontsource` packages, under the SIL Open Font License 1.1. The licence text ships with each package.

## Trademarks

Nintendo Switch and Joy-Con are registered trademarks of Nintendo Co., Ltd. This project is independent and is not affiliated with, endorsed by, or associated with Nintendo.
