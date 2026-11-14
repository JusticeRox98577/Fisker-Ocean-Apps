# Security Policy

Ocean Live is a one-person, owner-made app. Security fixes go into the newest release only.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 3.3.x   | Yes       |
| < 3.3   | No        |

Please update to the newest version (Play Store, TestFlight/App Store, or the latest
[GitHub release](https://github.com/JusticeRox98577/Fisker-Ocean-Apps/releases/latest))
before reporting.

## Known issue: Android APKs from GitHub up to 3.3.1

Android APKs attached to GitHub releases up to and including 3.3.1 were signed with a test
key whose password is public in this repository's history. Someone else could build an app
that installs as an update over them. From the next release on, every APK is signed only with
the private Ocean Live key. If you installed an APK from GitHub, uninstall it and install the
newest release. Play Store and TestFlight installs are not affected.

## Reporting a vulnerability

Report it privately through GitHub:
**[Report a vulnerability](https://github.com/JusticeRox98577/Fisker-Ocean-Apps/security/advisories/new)**
(the Security tab, then "Report a vulnerability").

Please don't open a public issue for a security problem.

Include what you can:

* the app and version (Android, Wear OS, iPhone, Apple Watch), and the phone and OS version
* the OBD adapter, if it matters
* what someone could do with it, and the steps to reproduce

What to expect:

* An acknowledgement within 7 days.
* An update at least every 14 days until it's resolved.
* If it's accepted, a fix in the next release, with credit in the release notes and the
  advisory if you want it. If it's declined, an explanation of why.

This is a spare-time project, so there is no bug bounty.

## What the app sends to the car

Ocean Live mostly reads. It never uses UDS security access (service 27), never writes data
(2E) and never runs routines (31). Only two actions change anything, and both need you to
confirm them: clearing stored fault codes (14), and restarting a module (11). For these it
also switches the module's diagnostic session (10) and fault logging (85) and back. A module
that needs security access refuses them.

Before these actions, and again before each module, the app needs fresh readings from the
current connection: the odometer hasn't changed and almost no power is going in or out of the
battery (under 1 kW either way). If the connection drops, it starts over. Restart isn't offered
at all for the brakes, steering, airbags, drive motors, gateway or battery management. The app
can't read the gear or the charge port, so this is a safeguard, not a guarantee: only use these
actions with the car in Park, unplugged and with the climate off.

## What counts

In scope:

* Anything that lets the app send a command to the car that the user didn't ask for, or that
  lets clearing codes or restarting a module happen while the car is driving or charging
* Anything that keeps the car from going to sleep
* Leaks of the user's data off the phone, including the ABRP token and API key
* The "Any questions?" server (`ask-proxy/`): exposing its Anthropic API key, getting past its
  daily limits or monthly spend cap, or seeing other people's questions
* Release files (APK, Play bundle, TestFlight build) that aren't signed with the official
  Ocean Live key, or a problem in the build workflows that could let someone change them

Out of scope:

* Weaknesses in the car itself, its modules or Fisker's former servers
* Weaknesses in third-party OBD adapters or in ABRP
* Wrong or unhelpful answers from "Any questions?" (please open a normal issue)
* Builds that weren't downloaded from this repository's releases or an official store,
  including unsigned build artifacts from the Actions tab
* Attacks that need an unlocked phone that's already in the attacker's hands

## Safe testing

Only test on a car you own, while it's parked and unplugged. Don't test against other
people's cars, phones or ABRP accounts.
