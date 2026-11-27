# Changelog

Each `## x.y.z` section is used as the release notes for that version.

## Unreleased

* The app opens on a choice: OBD (the dashboard, battery, trips and fault codes through your
  adapter) or Nova. Back (Android) or Home (iPhone) returns to it
* Nova: pair your phone with a SuperNova using the code on the car screen (you approve it in the
  car), then lock, unlock and run the climate from your phone, and see the car's last check-in and
  12V. Your phone's key is made on the phone and never leaves it; every command is signed and
  checked by the car
* News by email: sign up at oceanlive.org/news (or in the downloads section of the home page)
  to get an email when there's a new release or an important fix. Nobody is added without
  confirming by email, and every email has a one-click unsubscribe that deletes your address
* Help on the website: oceanlive.org/help explains the adapter you need, getting connected,
  each tab, the 12V watch, car screens and watches, your account and what to do when
  something doesn't work
* Fault codes on the website: oceanlive.org/codes explains how Ocean fault codes are built,
  lists the codes confirmed on real Ocean cars (search by code or word) and the modules the app
  scans, and says when clearing codes is safe. It is not a full code table
* Your account on the web: at account.oceanlive.org you can sign in with an email code to see,
  rename or delete your account without the app. It uses one cookie, only to keep you signed in
* Service status: status.oceanlive.org shows whether the website, the app server and the
  mail server are up
* More on the website: a page for each fault code confirmed on Ocean cars, each of the 39
  modules the app scans and each reading in a new glossary (oceanlive.org/glossary), all made
  from the owner guide; every release with its own page (oceanlive.org/releases); a charging
  time and cost calculator and a 12V battery check (oceanlive.org/calculators); the roadmap with
  vote counts (oceanlive.org/roadmap, voting with your account at account.oceanlive.org); an
  about page and a press kit; and oceanlive.org/site-index with every page in one place
* Account balance: your Ocean Live account can now hold credit, shown in Settings → Account
  (and at account.oceanlive.org). When today's free questions are used up, "Any questions?"
  can keep answering from your balance: each extra question costs what its answer cost,
  rounded up to the next cent, and the chat shows what it cost and what's left. A question
  that fails costs nothing. Credit will also pay for add-ons when there are any
* Pre-registration reward: if you pre-registered on Google Play or pre-ordered on the App
  Store, signing in adds US$5 of credit and an Early supporter badge to your account, once
  per store account and once per Ocean Live account. Terms: oceanlive.org/preregistration-terms.
  The privacy policy says what's stored for the balance and how a reward is checked
* Report an answer: every answer in "Any questions?" has a Report button. Pick a reason
  (offensive, harmful, wrong or other), add a note if you like, and it goes to the developer
  with that question. A report is deleted with its question
* Share what you know: tell "Any questions?" what a fault code meant on your car, a fix that
  worked, a fact about the Ocean or feedback about the app, and it can send it to Ocean Live for
  review. Nothing is used until an admin approves it; approved notes are kept without your name,
  help answer everyone's questions and appear at oceanlive.org/community. App feedback goes to
  the developer only. The privacy policy says what's stored and when it's deleted
* "Any questions?" can look beyond the owner guide: when a question needs it, Claude can search
  the web and read web pages (through Anthropic, which sends search terms made from your
  question to its search provider) and look at Ocean Live's public GitHub (issues, releases
  and files). Answers that do may list their sources. Claude is told to search only with
  what you asked, not your car's readings or balance, and it never sees your email address,
  account ID or install ID. Paid answers that search the web cost a little more from your
  balance (1 cent per search plus the AI cost). The privacy policy says what goes where
* Settings → Account (and account.oceanlive.org) now say under the balance that it's used
  automatically for extra "Any questions?" answers after your 10 free ones each day
* Privacy policy: says what's kept when you share something in "Any questions?" and for
  roadmap votes, how answer reports are kept, how the developer corrects a balance
  (every correction notes who made it and why), and that a claimed reward's hashed store
  reference stays after an account is deleted, so the same reward can't be claimed twice.
  It no longer says the install ID is shown under "Show what's sent": to have questions
  deleted, email with your account ID from Settings → Account
* Adapter that has to be replugged: when the adapter can't be reached, the app now says why
  (asleep or held by another app) and what to do, instead of a timeout. vLinker owners are
  told that firmware 2.2.82 or newer lets it wake up on its own in an electric car. If an
  adapter with the same name shows up at a new Bluetooth address (a vLinker MC+ gets a new one
  each time it's plugged in), the app offers to use it; it never switches by itself. The app
  only looks once, for up to 8 seconds, so it can't keep the car awake
* Connecting: an adapter that misses its first reset gets one more try. With "Keep the adapter
  connected", a link to an adapter that stopped answering is closed after 3 checks in a row and
  opened again at the next check. On Android, Find adapter says when the phone's Bluetooth
  search fails, and asks for Location on Android 11 and older, which need it for the search

## 3.4.0

* "Any questions?": tap the **?** at the top to ask Claude, Anthropic's AI, about your
  Fisker Ocean or the app. It answers from an Ocean owner guide and a fault code table and,
  unless you turn it off, sees your latest readings and fault codes (never the VIN or
  location). Asking never talks to the car. Questions go to the Ocean Live server and
  Anthropic, and are logged for research and deleted after 90 days. Up to 10 questions a
  day. English, German, Dutch, French and Spanish
* Ocean Live accounts: sign in with Google or a code sent to your email (on iPhone, also
  Sign in with Apple). After signing in, the app works offline. Car data stays on your phone.
  Rename or delete your account any time in Settings → Account
* Support Ocean Live: three optional tips in Settings → Support, through Google Play or the
  App Store. They unlock nothing. A small banner on the Live tab can be closed and never shows
  in the first 3 days, while driving or charging, or on Android Auto, CarPlay, widgets or the
  watch. Installs from oceanlive.org or GitHub don't show it
* New website: oceanlive.org, with the Android downloads
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
