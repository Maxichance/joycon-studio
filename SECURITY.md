# Security Policy

## Scope

Joycon Studio talks to Nintendo Switch controllers over Bluetooth HID and can write to their SPI flash memory. It has no network server and makes no network request.

These are treated as security or safety issues:

- a code path that writes to SPI flash without first saving a verified backup;
- a write that can reach a zone other than the color block (`0x6050`) or the user stick calibration (`0x8010`), or the wrong controller;
- an out-of-bounds read or write in HID report parsing or IR fragment assembly;
- a way for a web page or another local program to make the app act on a controller without the user asking;
- a dependency or build step that sends data off the machine.

Hardware damage caused by editing SPI values by hand outside the app is not in scope.

## Reporting a vulnerability

Use the **Report a vulnerability** button on the Security tab of the GitHub repository. It opens a private advisory visible only to the maintainer.

Do not open a public issue for anything that can brick a controller.

Include, as far as you can:

- controller model and firmware version (shown in Settings);
- what you did, step by step;
- what happened, and what you expected.

Remove your controller's Bluetooth address and serial number from anything you share.

## Supported versions

Only the latest release is supported.
