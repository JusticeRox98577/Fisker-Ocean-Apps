# Fisker Ocean owner knowledge for Ocean Live

This is the reference Ocean Live's "Any questions?" assistant answers from. It was written
for the app by its developer. Where a fact is uncertain it says so; when this guide does not
cover something, the assistant says it does not know rather than guessing.

## The car

* The Fisker Ocean is an all-electric mid-size SUV built for Fisker Inc. by Magna Steyr in
  Graz, Austria. Deliveries started in 2023 (model year 2023).
* Trims:
  * **Sport:** single front motor, front-wheel drive, smaller LFP (lithium iron phosphate)
    battery. Ocean Live assumes about 75 kWh usable for it.
  * **Ultra** and **Extreme** (the launch edition was called **One**): two motors,
    all-wheel drive, larger NMC battery. Ocean Live assumes about 106.5 kWh usable.
  * Owners can set their own usable capacity in Ocean Live (Settings, model "Custom"), and
    the Battery tab measures it from their own charges.
* The Sport's LFP pack is happy to be charged to 100 % regularly. For the NMC pack
  (Ultra/Extreme/One), the usual lithium-ion advice applies: daily charging to about 80 %,
  100 % before long trips, and avoid leaving it at very high or very low charge for days.
* Charging: CCS1 connector in North America, CCS2 in Europe. AC charging up to about 11 kW
  on a suitable charger. DC fast charging peaks are lower than the brochure figures in
  practice and depend heavily on battery temperature and state of charge; a cold pack charges
  slowly. Ocean Live's charging curve shows what the owner's own car actually does.
* The Ocean has a conventional 12 V battery that runs the car's computers, locks and
  contactors. If it goes flat the car cannot start its high-voltage system. The high-voltage
  battery tops the 12 V up while the car is awake or charging, not continuously while asleep.
* Fisker Inc. filed for Chapter 11 bankruptcy in June 2024 and stopped operating. Owners
  since rely on independent shops, owner groups (the Fisker Ocean Owners Association and
  online forums) and leasing companies that took over cars. Over-the-air updates and the
  Fisker app/cloud services are not something Ocean Live can promise or check. Advice on
  service, recalls and software should point the owner to those groups, a qualified EV shop,
  and, in the US, nhtsa.gov/recalls with their VIN.

## Sleep and the 12 V battery

* Every diagnostic request wakes modules on the car's network. A car kept awake drains its
  12 V battery and can end up not starting.
* Ocean Live stops talking to the car as soon as it stops answering, and after 10 minutes
  parked with the app in the background (unless CarPlay/Android Auto is showing it). It never
  sends keep-alive messages.
* "Watch 12V while the car sleeps" (off by default) only asks the adapter for its own supply
  voltage (`ATRV`), which puts nothing on the car's network, every 30 minutes (or 5 or 10),
  then disconnects so the adapter sleeps too.
* What the app says about 12 V voltage: resting voltage is read after the car has slept,
  before it starts charging the 12 V. 12.4 V or more is healthy. Resting under 12.4 V means
  the 12 V battery is weak or something draws power while parked. Under 12.0 V the car may
  not wake up. Over 13.2 V the car's DC-DC converter is charging the 12 V, which is normal
  while the car is awake. A healthy car loses only a few hundredths of a volt a night.
* Leaving an OBD adapter plugged in drains the 12 V a little. A vLinker FD+ uses about 51 mA
  awake and about 3 mA asleep (Vgate's figures). Owners who park for weeks should unplug it.

## Using Ocean Live (how-to)

Use the exact names of screens, buttons and settings below when telling owners where to tap.
The Android and iPhone apps have the same five tabs at the bottom (on Android in landscape
they move to a strip on the left): **Live, Battery, Trips, Faults, Settings**. The round **?**
at the top opens "Any questions?" (this chat). The app is made by an owner and is not
affiliated with Fisker. It also has a Wear OS app, an Apple Watch app, an Android home-screen
widget, iPhone Home and Lock Screen widgets, a charging Live Activity (iPhone, iOS 18+),
Android Auto and CarPlay.

### Getting connected

* Needed: a Bluetooth LE OBD adapter that speaks ELM327, such as a Vgate vLinker FD+ (most
  common with Ocean owners) or an OBDLink CX. Adapters that only do classic Bluetooth don't
  work on iPhone.
* Plug the adapter into the car's OBD port, turn the car on, open Ocean Live and on the Live
  tab tap **Find adapter**, then pick the adapter. The app remembers it; next time tap
  **Connect to <adapter>**, or **Choose a different adapter**.
* Settings > Adapter: **Connect automatically when the app opens** (on by default) and
  **Forget saved adapter**.
* The header shows the state: Connected to <adapter>, Connecting, Looking for adapters,
  Reconnecting, Not connected. In landscape a **Connect** / **Disconnect** button sits at
  the top right.
* Can't connect? Check Bluetooth is on and the app has Bluetooth permission, the adapter is
  plugged in and lit, and the car is on (not asleep). Close other apps that may be holding the
  adapter (including other OBD apps), then try **Find adapter** again. "This doesn't look like
  an OBD adapter" means a different Bluetooth device was picked.
* "The car is asleep. Ocean Live stopped reading so it can sleep" and "The car was parked with
  the app closed for 10 minutes…" are normal: the app stops on purpose so the 12 V doesn't
  drain. Opening the app (or plugging in the car screen) connects again.

### Live tab

* Charge ring with state of charge and estimated range, power in or out (into the battery,
  regenerating, from the battery, idle), and the state: Charging, DC fast charging, Driving,
  Parked.
* While charging: **This charge** with energy added, charging time, start time, peak power
  and time to the charge alert level ("To 80%").
* While driving: **This drive** with distance, energy used, efficiency and time.
* **Battery** summary: pack voltage, current, battery temperature, cell spread, odometer,
  12 V (tap the 12 V tile to open the 12 V screen), and ABRP status when ABRP is on.
* **While parked**: how much charge was lost since the app last saw the car.
* Range is estimated from the owner's own recent drives and the usable capacity set in
  Settings > Car.

### Battery tab

* **Battery health:** measured capacity, usable now and rated usable. The car doesn't report
  battery health directly; the app measures it from charging. Keep the app connected through
  a charge that adds at least 20%. Until then it shows "Not measured yet".
* **Parked drain:** average loss per day while parked, measured each time the app reconnects
  after the car sat.
* **Cells:** highest, average and lowest cell voltage and the spread. Under 60 mV is normal; a
  spread that keeps growing over weeks is worth a shop check.
* **Temperatures:** battery highest/average/lowest, coolant in/out, with a note (cold battery
  limits charging and regen; warm battery may limit fast charging).
* **High voltage:** pack voltage, pack current, power, isolation resistance. Also the VIN and
  charging totals.
* **Share battery report:** a one-page PDF of all of this plus the latest fault scan, for a
  buyer or a shop. It uses what the app already has and doesn't read from the car.
* **See the 12V history ›** opens the 12 V screen: graph for 24 h, 7 d, 30 d or 90 d,
  latest, lowest resting, average resting, how much of the awake time the car charged the
  12 V, when the car last charged it, and the overnight drop per night. **Share 12V data** as
  CSV, a picture or a PDF.

### Trips tab

* Filter **All / Drives / Charges**. Totals, regen (share of energy used), charging this
  month and its cost.
* Tap a charge for its **Charging curve** (kW against %), average power, implied capacity
  and cost. Drives show distance, energy, efficiency and regen.
* Costs need prices in Settings > Charging cost. **Export CSV** saves the history;
  **Clear history** deletes everything (including the data for measuring battery capacity)
  and can't be undone; single entries can be deleted.
* Drives and charges only appear if the app was connected during them.

### Faults tab

* **Scan all modules** reads stored fault codes from 39 modules (about a minute). Codes are
  marked Active now, Pending, Stored or Warning lamp; tap **Active now** to list active codes
  first. **New** marks codes that weren't there in the last scan; **Cleared since last scan**
  lists codes that went away. Some lists may be incomplete; scanning again usually fills them in.
* Tap a code for what it affects, possible causes and how it's fixed, when known.
* **Share report** sends a text fault report. **Past scans** keeps earlier scans.
* **Clear codes** (one module, or every module) and **Restart** a module are the only things
  that change anything in the car. Only with the car on and in Park, foot on the brake,
  charging cable unplugged and climate off; the app checks the car is still and almost no power
  flows, and stops if that changes. Restart is not offered for brakes, steering, airbags, drive
  motors, gateway or battery management. Clearing erases the history a workshop would use, so
  share the report first; codes for faults still present come back straight away. A restart is
  not a repair.
* Messages like "The car is moving. Park it first.", "The car is charging. Unplug it first."
  or "Power is flowing into or out of the battery…" mean a safety check stopped the action.
  "Needs a security key Ocean Live doesn't have" means that module can't be changed by the app.
* **Code descriptions:** built-in for standard and confirmed Ocean codes. **Import
  descriptions** loads a list (CSV "code,description", or JSON with names, causes and repair
  steps); several can be imported and they stay on the phone. **Remove imported descriptions**
  undoes it.
* **Module versions > Read module versions** lists each module's software version and part
  number. Reading changes nothing.

### Settings tab

* **Car:** model (Ocean One, Extreme or Ultra / Ocean Sport / Other or custom) and usable
  battery in kWh; used for range and charge-time estimates.
* **Charging cost:** currency symbol, home price and DC fast price per kWh.
* **Units and screen:** miles, Fahrenheit, keep the screen on while connected.
* **Adapter:** auto-connect, saved adapter, forget it. **Watch 12V while the car sleeps**
  (off by default): every 30 minutes (or 5 or 10, "Check every") the app briefly connects to
  the adapter, reads the 12 V and disconnects; the car stays asleep. **Keep the adapter
  connected** only for adapters that can't be woken over Bluetooth (about 50 mA). On iPhone,
  iOS only allows occasional background checks, so readings are less regular than on Android.
* **Alerts:** charge alerts (notify at a high level, at a low level, when charging stops) and
  **Battery warnings** (12 V low, uneven cells, hot pack). Alerts work while the app is
  connected, including in the background; 12 V warnings while asleep need the 12 V watch. The
  phone must allow notifications.
* **ABRP:** paste the ABRP generic token (in ABRP: open the car, Live data, Generic) and a free
  telemetry API key from abetterrouteplanner.com/resources/api. Both are needed. "Send every"
  sets the interval; **Include phone location** is optional. ABRP only gets data while the
  app is connected.
* **Advanced: Flip current sign**, only if charging shows as using power on that car.

### In the car, on the wrist, on the home screen

* **Android Auto / CarPlay:** show live charge, power, the current charge or drive and the
  battery readings, updated every second. The phone app must be connected to the adapter.
* **Landscape / split screen:** charge ring on the left, readings and Connect on the right,
  made for running next to ABRP.
* **Watches and widgets** only show what the phone already has; they never talk to the car.
  The Android widget and iPhone widgets show charge and range ("Tap to connect" opens the app).
  The iPhone Live Activity shows charging progress on the Lock Screen and Dynamic Island.

### Any questions? (this chat)

* Sends the question, and unless **Include my car's readings** is off, the latest readings and
  fault codes the app already has; never the VIN or location, and it never wakes the car.
  **Show what's sent** shows the exact text and the install ID. 10 free questions a day per phone; if the monthly budget runs out, questions pause for everyone until the next month.
  Questions are kept for 90 days for research; to have them deleted, the owner sends their
  install ID through the GitHub issues page.

### Help and privacy

* Bugs and ideas: github.com/JusticeRox98577/Fisker-Ocean-Apps/issues. Privacy policy:
  PRIVACY.md in that repository. Releases for Android are on that page's Releases; the iPhone
  app is in TestFlight.

## What some readings mean

* **Cell spread** (highest minus lowest cell voltage): under 60 mV is normal (the app's
  threshold); it naturally widens near empty and full and under heavy load. A spread that
  keeps growing over weeks is worth a shop check.
* **Insulation (isolation) resistance:** the high-voltage system's isolation from the car
  body. Very large values are normal. A value that falls sharply, or an isolation fault
  code, is a safety issue for a qualified shop; the owner should not open anything.
* **Pack temperatures:** a cold pack limits charging and regen; a hot pack limits power.
* **Power and current** are positive while energy flows into the pack (charging, regen).
* Readings come from the battery management module (BMS) with standard diagnostic requests.
  The app never uses security access.

## Fault codes

* Codes look like `B208896`: a letter for the system (P powertrain, C chassis, B body,
  U network), four characters for the base code, and two for the failure type.
* State: **active** (the fault is present now), **pending**, **stored** (happened before),
  **warning lamp** (the module asked for a warning light).
* Many U-codes (lost communication, signal outdated, integrity check failed) appear after a
  module was asleep, the 12 V dipped, or software was updated, and often clear and stay clear.
  Codes that come back right after clearing, or that come with a warning on the car's screen,
  point to a real problem.
* Codes U114281, U1142F1, U114381, U1143F1, U114581 and U1145F1 are common on cars running
  the O-Loop / ovloop 2.2.3+ software, where they are usually a side effect of the update.
* Clearing codes does not fix anything. It only resets the records; if the cause remains the
  code returns. Airbag (ACU), brake (ESP, IBOOSTER), steering (EPS) and high-voltage (BMS,
  PDU, PIU, MCU) faults should go to a qualified shop.
* Use the `lookup_fault_codes` tool for any specific code, including codes from the car's
  current readings. Its entries come from Fisker's service troubleshooting guide as extracted
  by owners, and from Ocean Live's own lists; their text was OCR'd and can contain typos.

### Ocean-specific codes confirmed from real cars

| Code | Meaning |
| --- | --- |
| U15AD87 | Lost communication with the power steering module |
| U1613F1 | End-to-end message check failed (a message failed its integrity check) |
| U199701 | Lost communication with HV coolant heater H (cabin heating may not work) |
| U199702 | Lost communication with HV coolant heater B (HV battery heater may not work) |
| U201162, U201262 | Communication verification failure |
| B20FE16 | Trailer module supply voltage below threshold (trailer lamps may not light fully) |
| B208896 | Overhead console touch controller not responding |
| B178854 | Module not coded (configuration missing) |
| C21A531 | Front camera: no signal on its Ethernet link (timeout) |
| C21A586 | Front camera: invalid signal on its Ethernet link |
| U114281 / U1142F1 | Climate control value invalid / signal outdated |
| U114381 / U1143F1 | Stability control (ABS) value invalid / signal outdated |
| U114581 / U1145F1 | Cockpit controller value invalid / signal outdated |

### Modules Ocean Live scans

BMS (HV battery), BCM (body control), VCU (vehicle control), MCU_F / MCU_R (front / rear
motor), PDU (power distribution), PIU (power integration unit), WTC and BTC (HV coolant
heaters A and B), ECC (climate), RAC (rear climate), ESP (stability control), IBOOSTER
(brake booster), EPS and EPS2 (power steering and backup), ACU (airbags), PKC (keys and NFC),
ICC (cockpit and screens), GW (gateway), TBOX_EU / TBOX_US (telematics), HYDRA (driver
assist), FCM (front camera), MRR (front radar), CMRR_FL/FR/RL/RR (corner radars), OHC
(overhead console), CIM (steering column), MFSS (steering wheel switches), DSMC / PSM
(driver / passenger seat), PWC_L / PWC_R (wireless phone chargers), PLGM (power liftgate),
TRM (trailer module), AMP (audio amplifier), VSP (pedestrian warning speaker).

### Common failure-type suffixes (last two characters)

11 short to ground, 12 short to battery, 13 open circuit, 16 voltage below threshold,
17 voltage above threshold, 1C voltage out of range, 31 no signal, 54 missing calibration,
55 not configured, 62 signal compare failure, 81 invalid serial data, 86 invalid signal,
87 missing message, 88 bus off, 96 component internal failure, F1 safety/integrity check.
