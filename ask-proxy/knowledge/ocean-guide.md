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
* A healthy 12 V battery rests at roughly 12.4–12.8 V after the car has slept. Resting
  voltage below about 12.2 V, or a big overnight drop, suggests a weak battery or something
  keeping the car awake. While the car is awake and charging the 12 V, 13–14.5 V is normal.
* Leaving an OBD adapter plugged in drains the 12 V a little. A vLinker FD+ uses about 51 mA
  awake and about 3 mA asleep (Vgate's figures). Owners who park for weeks should unplug it.

## Ocean Live, the app

* Made by an owner, not affiliated with Fisker. Android, iPhone, Wear OS and Apple Watch.
* Needs a Bluetooth LE OBD adapter that speaks ELM327, such as a Vgate vLinker FD+ (most
  common with Ocean owners) or an OBDLink CX. Plug it into the OBD port, turn the car on,
  open the app and tap "Find adapter". Classic-Bluetooth-only adapters do not work on iPhone.
* Tabs:
  * **Live:** state of charge, estimated range, power, the current charge (energy added,
    peak power, time to limit) or drive (distance, energy, efficiency).
  * **Battery:** pack voltage and current, cell voltages and their spread, battery and
    coolant temperatures, insulation resistance, measured usable capacity, PDF health report.
    Plus the 12 V screen: graph, resting voltage, overnight drop, alerts.
  * **Trips:** drives and charges, charging curves, regen per drive, charging cost, parked
    drain, CSV export.
  * **Faults:** reads stored fault codes from 39 modules with plain descriptions; can clear
    codes and restart a module, only while parked and not charging, always after asking.
  * **Settings:** units, car model, alerts, ABRP telemetry, 12 V watch, costs.
* Readings come from the battery management module (BMS) with standard UDS requests. The
  app never writes anything to the car except clearing fault codes and restarting a module
  when the owner asks, and never uses security access.
* What some readings mean:
  * **Cell spread** (highest minus lowest cell voltage): under about 20 mV at rest is
    normal; it naturally widens near empty and full and under heavy load. A spread that stays
    above about 50 mV at rest is worth watching.
  * **Insulation (isolation) resistance:** the high-voltage system's isolation from the car
    body. Very large values are normal. A value that falls sharply, or an isolation fault
    code, is a safety issue for a qualified shop; the owner should not open anything.
  * **Pack temperatures:** a cold pack limits charging and regen; a hot pack limits power.
  * **Power and current** are positive while energy flows into the pack (charging, regen).

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
