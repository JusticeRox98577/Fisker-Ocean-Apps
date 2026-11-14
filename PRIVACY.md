# Ocean Live privacy policy

Last updated: 13 November 2026 (added: accounts)

Ocean Live is an independent app made by an owner, Justice MontgomeryWalkup, for other
Fisker Ocean owners. This policy covers the Android, Wear OS, iPhone and Apple Watch apps.

## The short version

* No ads, no tracking.
* Version 3.4 has no account. From the next version, the app asks you to sign in once (with
  Google or a 6-digit email code, and on iPhone also with Sign in with Apple). The account
  holds your email address and a display name, and you can delete it in the app at any time.
  See [Accounts](#accounts).
* What the app reads from your car stays on your phone, except what you choose to send below.
* Data leaves your phone only when you sign in or manage your account (opening the account
  settings checks it with the server), when you ask a question in "Any questions?", or if you
  turn on live data to A Better Route Planner (ABRP) yourself.
* Questions (and, unless you turn it off, your car's latest readings) are answered by Claude,
  an AI made by Anthropic, through a small server the developer runs. For research, the
  developer keeps each question, its answer, the readings sent with it and a random install
  ID for 90 days, then deletes them.

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
* a random ID made for this install. It is not linked to your name, phone or car. If you are
  signed in, your session goes with it, so the server links the question to your account
  (see [Accounts](#accounts)).

### Research log

Every question is logged for research: to see what owners ask and how good the answers are,
and to improve the knowledge Claude answers from. Each log entry holds the date and time,
the install ID, your account ID if you are signed in, your phone's language, the question, the earlier messages of that chat, the
readings and fault codes sent with it (if any), the answer and its cost. Entries are kept in
a database at Cloudflare that only the developer can read, and are deleted automatically
after 90 days. Your IP address, VIN and location are never logged. The log is never sold,
shared or published, and is not used for advertising.

The chat screen shows your install ID under "Show what's sent". To have your logged questions
deleted, or to ask what is held, email justice@oceanlive.org with that ID; they are deleted within
30 days. You can also open an issue on GitHub, but issues are public: anyone can see what you
post there, including the ID. If you don't want your questions
logged, don't use "Any questions?". The legal basis in the EU and UK is the developer's
legitimate interest in improving the feature you chose to use.

Apart from the log, the question server keeps counters: questions per account (or per
install ID before you sign in) and per network per day (the IP address is turned into a salted hash and never stored as is),
deleted after about a day, and the month's total spend. Cloudflare and Anthropic see your IP
address as part of the connection.

Anthropic processes the question to produce the answer under its commercial terms, which do
not allow it to train models on this data by default, and keeps it only for a limited time;
see https://www.anthropic.com/legal/privacy. On your phone, the chat lives only in the app's
memory and is gone when you close the app or tap "New chat".

Don't put personal details in questions. Answers come from an AI and can be wrong; check
anything important with a qualified EV shop.

## Accounts

Version 3.4 has no account. From the next version, the app asks you to sign in once before
you use it, with Google or with a 6-digit code sent to your email address; the iPhone app also
offers Sign in with Apple. There are no passwords. The account keeps your "Any questions?" questions, and their
daily limit, secure and tied to you, also when you change phones. Your car data never goes to
your account: it stays on your phone, and the app works offline after signing in.

What the Ocean Live server stores for an account, in the same Cloudflare D1 database as the
research log, which only the developer can read:

* **The account:** a random account ID, your email address (as verified by Google, by the
  email code, or by Apple, which may give a private relay address instead), a display name
  (from Google or Apple at first; you can change it in the app), and when the account was
  created and last used.
* **Sign-in methods:** for each method you have used, the provider (Google, Apple or email)
  and that provider's ID for you (for email, the address). Signing in with another method
  that has the same verified email address uses the same account.
* **Sessions:** after you sign in, the server gives the app a random session token and keeps
  only a SHA-256 hash of it, with when it was created and last used. A session lasts 365 days
  from its last use. Signing out deletes it (if your phone is offline at that moment, the
  session simply expires).
* **Your questions:** questions you ask while signed in are linked to your account, and when
  you sign in, the questions this install asked before are linked to it too. They are still
  deleted after 90 days (see Research log).
* **Email codes:** when you ask for a code, the server keeps your email address with a hash of
  the code. The code works for 10 minutes and allows 5 tries. The entry is kept until you
  use the code or, if unused, removed within a day after it expires; deleting your account
  also removes it. To limit abuse, the server counts code requests for an hour per email
  address and per network, stored only as hashes. The sign-in email loads its banner and the
  app icon from oceanlive.org, so opening it with images shown sends a request to Cloudflare
  (your IP address and the time), as a visit to the website would.

Who processes it:

* **Cloudflare** runs the server and its database and storage.
* **Resend** delivers the sign-in code emails, so it receives your email address and the code.
* **Google**, when you sign in with Google: Google tells the server your Google account ID,
  email address and name, signed so the server can check it is genuine. **Apple** does the
  same when you use Sign in with Apple on iPhone. The server only downloads
  Google's and Apple's public keys to check these; it sends them nothing about you.
* **Anthropic** only receives questions, as described above.

The account and its sign-in methods are kept until you delete the account. To delete it, open
Ocean Live and go to Settings, Account, Delete account. This deletes, straight away, the
account, its sign-in methods, all its sessions (every device is signed out), the logged
questions linked to it and any personal question limit set for it. Car data on your phone is
not affected. An email-code entry for your address (see Email codes) is removed too. The
short-lived counters above expire on their own within about a day. If you can't use the app
any more, see https://oceanlive.org/delete-account.

<!-- Owner review: legal basis for account data. -->
The legal basis in the EU and UK for account data is performance of a contract (providing the
signed-in app and keeping your questions with your account); for the abuse and rate-limit
counters it is the developer's legitimate interest.

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

Questions: email justice@oceanlive.org, or open an issue at
https://github.com/JusticeRox98577/Fisker-Ocean-Apps/issues
