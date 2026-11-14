# Ocean Live privacy policy

Last updated: 13 November 2026

Ocean Live is an independent app made by an owner, Justice MontgomeryWalkup, for other
Fisker Ocean owners. This policy covers the Android, Wear OS, iPhone and Apple Watch apps.

## The short version

* No account, no sign-in, no ads, no analytics, no tracking.
* What the app reads from your car stays on your phone, except what you choose to send below.
* Data leaves your phone only when you ask a question in "Any questions?", or if you turn on
  live data to A Better Route Planner (ABRP) yourself.
* Questions (and, unless you turn it off, your car's latest readings) are answered by Claude,
  an AI made by Anthropic, through a small server the developer runs. That server does not
  store questions or answers.

## What the app reads and stores

Through your Bluetooth OBD adapter, Ocean Live reads your car's battery data (charge,
voltages, current, temperatures, cell voltages, insulation resistance), the 12V battery
voltage, the odometer, the VIN and stored fault codes. It keeps your drive, charge, 12V and
fault scan history, your settings and any fault code description lists you import.

All of this is stored only in the app's private storage on your device. It is removed when
you delete the app, and you can clear history in the app at any time. Files you choose to
share (CSV exports, reports, fault reports) are shared only where you send them.

## Permissions

* **Bluetooth:** to connect to the OBD adapter. This is how the app gets its data.
* **Location:** only if you turn on location sharing for ABRP. It is used only to include
  your position in the data sent to ABRP, and only while that setting is on.
* **Notifications:** for charge alerts and 12V battery warnings, if you turn them on.
* **Background activity:** to keep reading during a drive or charge, and, only if you turn
  on "Watch 12V while the car sleeps", to briefly check the 12V voltage while the car sleeps.

## "Any questions?" (only when you use it)

When you send a question, Ocean Live sends it over an encrypted connection to the Ocean Live
question server (a Cloudflare Worker run by the developer), which passes it to Anthropic's
Claude API to be answered. With the question go:

* the earlier messages of the same chat, so Claude can follow the conversation;
* unless you turn off "Include my car's readings" (on by default): the latest readings the
  app already has (charge, pack voltage and current, temperatures, cell voltages, insulation
  resistance, 12V voltage, odometer, driving or charging state), your car model and unit
  settings, and the fault codes from your last scan in this session. The chat screen shows
  exactly this text under "Show what's sent". Your VIN and location are never included,
  and asking never connects to or wakes the car;
* a random ID made for this install, used only to limit how many questions one install can
  ask per day.

The question server does not store or log questions or answers. It keeps only counters:
questions per install ID and per network per day (the IP address is turned into a salted hash
and never stored as is), deleted after about a day, and the month's total spend. Cloudflare
and Anthropic see your IP address as part of the connection.

Anthropic processes the question to produce the answer under its commercial terms, which do
not allow it to train models on this data by default, and keeps it only for a limited time;
see https://www.anthropic.com/legal/privacy. The chat itself lives only in the app's memory
and is gone when you close the app or tap "New chat".

Don't put personal details in questions. Answers come from an AI and can be wrong; check
anything important with a qualified EV shop.

## A Better Route Planner (optional)

If you enter your own ABRP token and API key, Ocean Live sends live telemetry (charge,
power, voltage, current, battery temperature, odometer, charging state and, if you allow it,
your location) to ABRP's servers (Iternio) so ABRP can plan your route. That data is handled
under ABRP's own privacy policy. Remove the token and key to stop it at any time.

## Watches, widgets and CarPlay / Android Auto

The watch apps, widgets, Live Activity, CarPlay and Android Auto only show data your phone
already has. The watch receives it directly from your phone through the platform's own
phone-to-watch connection.

## Children

Ocean Live is meant for vehicle owners and is not directed at children.

## Changes

If this policy changes, the new version will be posted here with a new date.

## Contact

Questions: open an issue at
https://github.com/JusticeRox98577/Fisker-Ocean-Apps/issues
