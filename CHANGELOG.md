# Changelog

Each `## x.y.z` section is used as the release notes for that version.

## Unreleased

* "Any questions?": tap the **?** at the top to ask Claude, Anthropic's AI, about your
  Fisker Ocean or the app. It answers from an Ocean owner guide and a fault code table and,
  unless you turn it off, sees your latest readings and fault codes (never the VIN or
  location). Asking never talks to the car. Questions go to the Ocean Live server and
  Anthropic; nothing is stored. Up to 20 questions a day. English, German, Dutch, French and
  Spanish
* Android APKs on GitHub are now signed only with the official Ocean Live key. APKs from
  GitHub up to 3.3.1 used a test key that is public, so someone else could make an update
  that installs over them. If you installed one, uninstall it once and install the new one;
  after that, updates install over it as usual. Play Store installs are not affected
* New SECURITY.md: how to report a security problem privately
* Safer fault clearing and module restarts: before them, and again before each module, Ocean
  Live checks fresh readings that the car isn't moving and that almost no power is flowing (so
  it isn't charging and the climate is off). If the car moves or starts charging part way, it
  stops and says why. Restart is no longer offered for the brakes, steering, airbags, drive
  motors, gateway or battery management
* The overnight 12V watch goes back to full reading at most once every 2 hours
* iPhone: your ABRP token and key are now kept in the Keychain on this iPhone only, out of
  backups. Android: they're left out of backups and phone-to-phone transfers
* Android Auto: only Android Auto itself can open Ocean Live's car screen
* License updated to version 1.1: Washington State law, and severability

## 3.3.1

* Landscape and split-screen layout, like 1.9: the charge ring on the left, six readings
  beside it and the Connect button always at the top right. Made for running Ocean Live in
  split screen on the Ocean's display under ABRP, and for phones held sideways
* Android: the tab bar moves to a slim strip on the left in landscape
* iPhone: no longer locked to portrait

## 3.3.0

* 12V battery monitor: graph over 24 h to 90 days, resting voltage after the car has slept,
  overnight drop, time since the car last charged it, low-voltage alerts and sharing as CSV
  or an image
* Optional "Watch 12V while the car sleeps": a quick check every 30 minutes that lets the
  adapter sleep in between, without waking the car
* Charging curve for every charge, and regen energy per drive
* Shareable battery health report (PDF)
* Wear OS app with tile and complication, and Apple Watch app
* German, Dutch, French and Spanish

## 3.2.0

* Faults: tap "Active now" to list every active code first; new and cleared codes since the
  last scan; scan history; module software versions
* Parked drain tracker and charging cost per session and per month
* iPhone: Home and Lock Screen widgets, and a charging Live Activity
* Ocean Live no longer keeps the car awake: it stops reading when the car sleeps or after
  10 minutes parked in the background

## 3.1.0

* Rebuilt app with the verified battery readings, trips and charging history, fault codes
  from 39 modules with plain-language descriptions, clearing codes and restarting modules,
  alerts, Android Auto, CarPlay, Android widget and optional ABRP live data
