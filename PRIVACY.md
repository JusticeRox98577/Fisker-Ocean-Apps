# Ocean Live privacy policy

Last updated: 28 November 2026 (added: Nova pre-orders)

Ocean Live is an independent app for Fisker Ocean owners, made by Ocean Live LLC, a Washington
company founded by an Ocean owner, Justice MontgomeryWalkup. Ocean Live LLC is responsible for the
data described here. This policy covers the Android, Wear OS, iPhone and Apple Watch apps,
the Ocean Live mailing list and the Nova hardware beta sign-up.

## The short version

* No ads, no tracking.
* From version 3.4, the app asks you to sign in once (with
  Google or a 6-digit email code, and on iPhone also with Sign in with Apple). The account
  holds your email address and a display name, and you can delete it at any time, in the app
  or at account.oceanlive.org. See [Accounts](#accounts).
* Your account can hold a balance of Ocean Live credit and badges, such as the US$5 and Early
  supporter badge for pre-registering on Google Play or pre-ordering on the App Store. See
  [Balance and rewards](#balance-and-rewards).
* What the app reads from your car stays on your phone, except what you choose to send below.
* Data leaves your phone only when you sign in or manage your account (opening the account
  settings checks it with the server), when you ask a question in "Any questions?" or report
  an answer, when the app claims a pre-registration or pre-order reward for your account, or if you turn on live
  data to A Better Route Planner (ABRP) yourself.
* The mailing list on oceanlive.org is separate from the app and only for people who sign up
  and confirm. It keeps your email address and language until you unsubscribe. Testers may be
  asked once by email whether they want to join. See [Mailing list](#mailing-list).
* The Nova hardware beta sign-up at hardware.oceanlive.org is separate too. It keeps what you
  fill in (your email address, your top five features and any details you add) so the
  developer can plan Nova and pick testers. Only the developer can read it; the page shows
  totals only. See [Nova hardware beta](#nova-hardware-beta-only-if-you-sign-up).
* Questions (and, unless you turn it off, your car's latest readings) are answered by Claude,
  an AI made by Anthropic, through a small server the developer runs. To answer, Claude can
  also search the web through Anthropic (search terms made from your question go to
  Anthropic's search provider) and read Ocean Live's public GitHub. See
  [Web search and GitHub](#web-search-and-github). For research, the
  developer keeps each question, its answer, the readings sent with it and a random install
  ID for 90 days, then deletes them. If you report an answer, the report is kept with that
  question and deleted with it.
* If you share a fault code meaning, a fix, a car fact or feedback about the app in "Any
  questions?", it is stored for an admin to review. Only approved notes are used: in answers
  for everyone and on oceanlive.org/community, without your name or anything linking them to
  you. See [Sharing what you know](#sharing-what-you-know).

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

### Web search and GitHub

Besides its owner guide and fault code table, Claude can look further when a question needs
it:

* **Web search:** Claude can search the web and read web pages with Anthropic's web search
  and web fetch tools. The search terms are written by Claude from your question and sent
  through Anthropic to the search provider Anthropic uses; web pages are fetched by
  Anthropic, not by your phone or the Ocean Live server. Claude is told to search only with
  what your question says, and not to add your car's readings, your balance or anything else
  about you beyond what you typed. Your email address, account ID and install ID are never
  given to Claude, so they can't be part of a search.
* **GitHub:** Claude can look at Ocean Live's public GitHub repository
  (github.com/JusticeRox98577/Fisker-Ocean-Apps): its issues, releases and files. The Ocean
  Live server fetches them from GitHub, so GitHub only gets the search words (made the same
  way as web search terms), issue numbers or file names Claude asks for, from the server and
  not from your phone. Only public content is read, and nothing is ever posted to GitHub.

Answers that use the web or GitHub may list their sources. Web pages and GitHub content can
be wrong or out of date; Claude is told to treat them as information only, never as
instructions.

### Research log

Every question is logged for research: to see what owners ask and how good the answers are,
and to improve the knowledge Claude answers from. Each log entry holds the date and time,
the install ID, your account ID if you are signed in, your phone's language, the question, the earlier messages of that chat, the
readings and fault codes sent with it (if any), the answer and its cost. Entries are kept in
a database at Cloudflare that only the developer and the admins they appoint can read (admins
only through the admin page, which shows the questions, answers and readings without your
account ID, install ID or email address; see [The admin page](#the-admin-page)), and are
deleted automatically after 90 days. Your IP address, VIN and location are never logged. The log is never sold,
shared or published, and is not used for advertising.

To have your logged questions deleted, or to ask what is held, email justice@oceanlive.org;
they are deleted within 30 days. If you are signed in, include your account ID, shown in
Settings, Account (deleting your account also deletes them, straight away). The app doesn't
show the install ID, so for questions asked without signing in, say roughly when you asked
and what about, so they can be found. You can also open an issue on GitHub, but issues are
public: anyone can see what you post there. If you don't want your questions
logged, don't use "Any questions?". The legal basis in the EU and UK is the developer's
legitimate interest in improving the feature you chose to use.

Apart from the log, the question server keeps counters: questions per account (or per
install ID before you sign in) and per network per day (the IP address is turned into a salted hash and never stored as is),
deleted after about a day, and the month's total spend. Cloudflare and Anthropic see your IP
address as part of the connection.

### Reporting an answer

Each answer in the chat has a **Report** button (**Report answer** on iPhone), for an answer that is offensive, harmful or
wrong. A report sends the server the ID of that logged question, the reason you pick, an
optional note you write (up to 500 characters) and, as with a question, your session or the
install ID, so the server can check the question is yours. The server stores the report with
the question: the reason, the note, your account ID or install ID and the date. The developer
and the admins they appoint read reports on the admin page, without your account ID or install
ID, to fix the answer and improve the knowledge Claude answers from; they are not sent to
Anthropic or anyone else. When an admin marks a report as dealt with, the report also holds
when and the admin's email address. A report is deleted together with its question: after 90
days, when you delete your account, or when you ask (see above). To limit abuse, the server
counts reports per account or install for a day. Don't put personal details in the note.

### Sharing what you know

In "Any questions?" you can tell Claude something you know about the Ocean (what a fault code
meant on your car, a fix or tip that worked, or a fact about the car) or give feedback about
the app. When you clearly offer something like that, Claude can pass it on to Ocean Live for
review, and says so in the chat. It sends only what you said, restated briefly, and is told to
leave out names, email addresses, VINs and other personal details, but please don't include
them.

What the server stores when something is sent, in the same database as the research log:

* the kind (fault code, fix or tip, car fact, or app feedback), a one-line summary, the details
  (up to 2,000 characters) and, for a fault code, the code;
* the date, your account ID if you are signed in (otherwise the install ID), and a link to the
  logged question it came from;
* a counter of how many things your account or install sent that day (at most 5 a day), deleted
  after about a day.

Nothing is stored if the question ends without an answer. The store review account can't send
anything.

The developer and the admins they appoint review what is sent on the admin page, which shows
the summary, details and code, and the question it came from while that question is still in
the research log, but not your account ID, install ID or email address. They can edit it,
approve it or turn it down. App feedback goes to a feedback list for the developer, may be
turned into an item on the public roadmap (in the admin's own words), and is never used in
answers. Nothing is sent to anyone else.

When an admin approves something, its links to your account or install and to your question are
removed straight away, and it becomes a note (a title and text, which the admin may have
edited) with no name or identifier. Approved notes are given to Claude with every question,
from everyone, marked as notes from owners that may be incomplete, and are shown publicly at
oceanlive.org/community. An admin can retire a note at any time, which takes it out of answers
and off the website. Approved notes are kept until they are retired, also after you delete your
account, because nothing links them to you any more; the record of the approval keeps the
summary and details that were sent, without those links, and the email address of the admin who
approved it.

Items not reviewed yet are kept until an admin reviews them. Items turned down, and feedback
marked as dealt with, are deleted 90 days after that. Deleting your account deletes, straight
away, everything you sent that has not been approved and all your app feedback. To have what
you sent deleted without deleting an account, email justice@oceanlive.org, as for the research
log above. The email address of the admin who reviewed an item is kept with it and in the log
of admin actions. The legal basis in the EU and UK is the developer's legitimate interest in
improving the answers and the app, with the information you chose to share.

Anthropic processes the question to produce the answer under its commercial terms, which do
not allow it to train models on this data by default, and keeps it only for a limited time;
see https://www.anthropic.com/legal/privacy. Web searches and page fetches for an answer are
made by Anthropic as part of the same service. On your phone, the chat lives only in the
app's memory and is gone when you close the app or tap "New chat".

Don't put personal details in questions: words from a question can end up in a web search.
Answers come from an AI and can be wrong; check anything important with a qualified EV shop.

## Accounts

From version 3.4, the app asks you to sign in once before
you use it, with Google or with a 6-digit code sent to your email address; the iPhone app also
offers Sign in with Apple. There are no passwords. The account keeps your "Any questions?" questions, and their
daily limit, secure and tied to you, also when you change phones. Your car data never goes to
your account: it stays on your phone, and the app works offline after signing in.

What the Ocean Live server stores for an account, in the same Cloudflare D1 database as the
research log, which only the developer can read (and admins, through the admin page; see
[The admin page](#the-admin-page)):

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
  deleted after 90 days (see Research log), together with any report you made about them.
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
* **Google Play** checks a pre-registration reward when the app claims one (see
  [Balance and rewards](#balance-and-rewards)).
* **Anthropic** only receives questions, as described above.

The account and its sign-in methods are kept until you delete the account. To delete it, open
Ocean Live and go to Settings, Account, Delete account. This deletes, straight away, the
account, its sign-in methods, all its sessions (every device is signed out), the logged
questions linked to it and your reports about them, any personal question limit set for it,
what you shared in "Any questions?" that has not been approved, your app feedback, your roadmap
votes (approved notes stay, with nothing linking them to you; see [Sharing what you
know](#sharing-what-you-know)), and its balance, ledger and badges (unused credit is lost; only
the hashed store reference of a claimed reward stays, see Balance and rewards). Car data on your phone is
not affected. An email-code entry for your address (see Email codes) is removed too. The
short-lived counters above expire on their own within about a day. You can also delete it on
the account website (below). See https://oceanlive.org/delete-account.

<!-- Owner review: legal basis for account data. -->
The legal basis in the EU and UK for account data is performance of a contract (providing the
signed-in app and keeping your questions with your account); for the abuse and rate-limit
counters it is the developer's legitimate interest.

### The account website

You can also manage your account without the app at https://account.oceanlive.org: sign in
with a 6-digit email code (or with Google, when it's offered there; Sign in with Apple isn't)
to see your account and its sign-in methods, rename it, sign out or delete it. It uses the
same account, the same server and the same processors as the app, described above.

Signing in there sets one cookie. It is strictly necessary: it only keeps you signed in, holds
the session token (the server keeps only its hash, as for the app) and is sent only to
account.oceanlive.org. A session there lasts 30 days from its last use; signing out ends it
and removes the cookie. The account website uses no analytics or trackers. If Sign in with
Google is offered there, the page loads Google's sign-in button from Google, so Google sees
your IP address when you open it.

The account website also has the roadmap (account.oceanlive.org/roadmap), where you can vote
for items on the public Ocean Live roadmap, also shown at oceanlive.org/roadmap. For each vote
the server stores the item, your account ID and the date. Only the number of votes per item is
shown, to everyone; the admin page shows the counts, not who voted. You can take a vote back at
any time. Votes are deleted with your account, or when the item is deleted. To limit abuse, the
server counts vote changes per account for a day.

oceanlive.org itself still sets no cookies. (The admin page, admin.oceanlive.org, sets one
sign-in cookie for admins; see [The admin page](#the-admin-page).)

### Balance and rewards

Your account can hold a balance of Ocean Live credit, and badges. The balance pays for extra
"Any questions?" questions after the free daily ones (each costs what that answer cost the
developer at Anthropic, rounded up to the next cent), and for Ocean Live add-ons when they're
offered. If you pre-registered for Ocean Live on Google Play, or pre-ordered it on the App
Store, the app claims US$5 of credit and an Early supporter badge for the account you're signed
in to (see https://oceanlive.org/preregistration-terms).

What the server stores for this, in the same database as the account:

* **Balance:** the amount, in cents, and when it last changed.
* **Ledger:** one line per credit or spend, with the amount, the kind (reward, question, add-on
  or a correction made on the admin page), a reference and the date. A correction also has a
  note saying why, with the email address of the admin who made it (see
  [The admin page](#the-admin-page)). For a question the reference is
  the question's ID; the ledger line holds only the amount, not the question, and stays after
  the question itself is deleted at 90 days. For a reward the reference identifies the store
  purchase so it can't be claimed twice: for Google Play a SHA-256 hash of the purchase token,
  for the App Store a SHA-256 hash of Apple's ID for your download of the app (its app
  transaction ID).
* **Badges:** which badge the account has and when it was added.

How a reward is checked:

* **Google Play:** Google Play gives the reward to the app as an item. The app confirms it with
  Google Play straight away, so Google doesn't take it back while you're not signed in yet.
  When you're signed in, the app sends the item's product ID and purchase token to the Ocean
  Live server, which asks Google Play's developer API whether it is genuine, and confirms it
  there if the app hasn't. Google receives only the purchase token it issued; the server tells
  Google nothing else about you.
* **App Store:** the app sends the server the App Store's signed record of your download of the
  app, which says when you pre-ordered. It also holds the app version, the download date and a
  value for checking the device. The server checks Apple's signature itself, without contacting
  Apple, and keeps only a SHA-256 hash of the app transaction ID (in the ledger reference).

The balance, ledger and badges are kept until you delete the account, and deleting it deletes
them straight away. Only one thing stays after the account is deleted: the hashed store reference
of a reward it claimed (the SHA-256 hash of the Google Play purchase token, or of the App
Store app transaction ID), with the date it was claimed, in a separate list with no account
ID, email address or anything else. It is kept with no end date, only so the same store
purchase can't be rewarded again to a new account, and is used for nothing else. The legal basis for
that is legitimate interest (preventing the same reward from being paid out twice). Credit has no cash value and can't be moved to another account. The legal
basis in the EU and UK is performance of a contract (keeping your credit and badge and letting
you spend it).

### The admin page

The developer, and people the developer appoints as admins, look after balances on a separate
page, admin.oceanlive.org. Only admins can sign in there, with Google only, and app accounts
can't (signing in to the app never makes anyone an admin). An admin can look up an account by
its exact email address or its account ID, see its account ID, email address, display name,
sign-in methods (Google, Apple or email code), creation date, balance, badges and recent ledger
lines, add or remove credit (a balance can't go below zero) and give or
remove a badge. Every change records the admin's email address: in the ledger note for a credit
change, and in a log of admin actions (the admin, what was done, the account ID and the date).
Corrections and their log entries are deleted with your account, like the rest of the ledger.

To run and improve the service, admins also see on that page: totals (questions and AI cost
per day and month, the number of accounts, credit spent and still held in balances, rewards
claimed, open reports), the questions asked by phone language and by signed in or not, the
logged questions with their answers, cost and the readings sent with them, and the reports
with their question and answer. None of this shows the account ID, install ID or email address
of who asked or reported next to the question or report. But an admin who also looks up an
account sees its ledger, where each paid question has a time and an amount, so a paid question
can sometimes be matched to that account; and what someone writes in a question can itself say
who they are. When an admin marks a report as dealt with, their email address is
kept with the report and in the log of admin actions.

For admins only, the server stores: their Google email address and who added them and when;
for each sign-in, a hash of a random session token, kept for 12 hours; and the log of their
actions. Signing in there sets one strictly necessary cookie, sent only to admin.oceanlive.org,
that keeps the admin signed in. The page loads Google's sign-in button from Google. Removing an
Admins also review what owners share in "Any questions?" and the app feedback (see [Sharing
what you know](#sharing-what-you-know)), and write the public roadmap, where they see vote
counts but not who voted. The admin's email address is kept with each review, and in the log of
admin actions.

admin deletes their sessions straight away. The legal basis in the EU and UK is the developer's
legitimate interest in running the service and keeping a record of who changed what.

## A Better Route Planner (optional)

If you enter your own ABRP token and API key, Ocean Live sends live telemetry (charge,
power, voltage, current, battery temperature, odometer, charging state and, if you allow it,
your location) to ABRP's servers (Iternio) so ABRP can plan your route. That data is handled
under ABRP's own privacy policy. Remove the token and key to stop it at any time.

## Watches, widgets and CarPlay / Android Auto

The watch apps, widgets, Live Activity, CarPlay and Android Auto only show data your phone
already has. The watch receives it directly from your phone through the platform's own
phone-to-watch connection.

## Mailing list (only if you sign up)

On oceanlive.org you can sign up for Ocean Live news: an email when there's a new release or
an important fix, a few times a year. Nobody is added without confirming. After you sign up,
you get an email with a link, and you are only on the list once you open it and press
**Confirm my subscription**.

What the Ocean Live mail server stores, in a Cloudflare D1 database that only the developer
can read:

* your email address and the language for the emails (English, German, French, Spanish or
  Dutch, taken from your browser);
* whether you have confirmed, when you signed up and when you confirmed, and which version of
  the sign-up wording you agreed to;
* until you confirm: a hash of the confirmation code, when it expires and how many
  confirmation emails were sent;
* a random code for your unsubscribe link;
* for each news email: whether it was sent to you, and the delivery service's message ID or
  error.

To limit abuse, the server also counts sign-ups per network for an hour, stored only as a
salted hash of the IP address and deleted within about a day. That count is not linked to your
email address.

Why: only to send you Ocean Live news. Your address is never sold or shared, and never used
for anything else. The emails have no ads. Like the sign-in email, they load their banner from
oceanlive.org, so opening one with images shown sends a request to Cloudflare (your IP address
and the time).

Who processes it: **Cloudflare** stores it and runs the server; **Resend** delivers the
emails, so it receives your email address and each email.

How long: a sign-up that isn't confirmed is deleted after 7 days. Unsubscribing deletes your
address straight away. Every email has an unsubscribe link, and mail apps that show an
Unsubscribe button (such as Gmail) unsubscribe you in one click. You can also email
justice@oceanlive.org to have your address deleted, or to ask what is held.

The legal basis in the EU and UK is your consent, which you can withdraw at any time by
unsubscribing.

### Invitations for testers

People who test Ocean Live may get **one** email from the developer asking whether they want
these news emails. To send it, their email address goes to Resend. It creates an unconfirmed
sign-up like the one above: nothing more is sent unless they press **Confirm my subscription**,
and if they don't, it is deleted after 7 days like any unconfirmed sign-up.

So that nobody is invited twice, or after leaving the list, the server keeps a SHA-256 hash of
the address (not the address itself) for everyone who was invited, unsubscribed, was removed,
or let a sign-up lapse. It is kept with no end date and used for nothing else. A hash can't be
read back, but someone who already knows an address can check it against the hash, so it still
counts as personal data. Email justice@oceanlive.org to have it removed (you could then be
invited again). The legal basis in the EU and UK is legitimate interests: asking testers once,
and respecting the answer.

## Nova hardware beta (only if you sign up)

At hardware.oceanlive.org you can sign up to beta test Nova, the add-on hardware for the Fisker
Ocean that the developer is building. It is separate from the app, your account and the mailing
list: signing up doesn't create an account or add you to the news emails.

What is stored, in a Cloudflare D1 database that only the developer can read:

* your email address, and whatever else you choose to fill in: your name, country or region,
  which Ocean you have, which phone you use, which Nova products you'd like to test, your five
  most important features in order, a feature you wrote in, whether you'd install it yourself,
  and your notes;
* when you signed up and when you last changed your answer (signing up again with the same
  address replaces your earlier answer);
* if you are picked as a tester: that you were picked and when, a hash of the code in your
  invitation link, and whether and when you said yes or no.

To limit abuse, the server counts sign-ups, and tries of invitation links, per network for an
hour, stored only as a hash of the IP address and deleted within a day. That count is not linked
to your email address.

What everyone can see: only totals, on hardware.oceanlive.org: how many people signed up, how
many are interested in each Nova product, and how many test boards are taken. Never your name,
email address or answers.

Why: to plan Nova (which features matter most) and to pick beta testers and email them about the
beta. Your answers are never sold or shared, and never used for anything else.

Who processes it: **Cloudflare** stores it and runs the server. If you are picked, the
invitation email is delivered by **Resend**, so it receives your email address and that email,
and a copy is kept in the developer's mailbox on the Ocean Live mail server. The sign-up page
sets no cookies. (Its admin page, for the developer only, sets one strictly necessary sign-in
cookie.)

How long: until the Nova beta is over, or until you ask for it to be deleted, whichever comes
first. Email justice@oceanlive.org to have your answer deleted, or to ask what is held.

The legal basis in the EU and UK is your consent, given when you sign up, which you can withdraw
at any time by asking for your answer to be deleted.

## Nova pre-orders (only if you reserve)

At preorder.oceanlive.org you can reserve a Nova Light or a SuperNova from Ocean Live LLC.
Reserving is free and takes no payment details. It is separate from the app, your account, the
mailing list and the beta sign-up.

What is stored, in the same Cloudflare D1 database as the beta sign-up, which only the developer
can read: your email address, which product you reserved, the price and deposit when you
reserved, whatever else you choose to fill in (your name, state, which Ocean you have, your
notes), the state of your reservation (waiting for confirmation, reserved, deposit asked for,
deposit paid, cancelled) and when each of those happened, and a hash of the code in your
reservation link.

To limit abuse, the server counts reservations and link tries per network for an hour, stored
only as a hash of the IP address and deleted within a day.

What everyone can see: only how many people have reserved each product. Never who.

Why: to know when enough people have reserved a product to build it, to email you about your
reservation (the confirmation, the deposit request when the batch is built, and shipping), and to
keep a record of the order. Never sold or shared, and never used for anything else.

Who processes it: **Cloudflare** stores it and runs the server, and the emails are delivered by
**Resend**, with a copy in the developer's mailbox on the Ocean Live mail server. When you pay a
deposit, the payment provider named on the payment page handles your payment details; Ocean
Live never sees your card number. The pre-order pages set no cookies.

How long: a reservation you never confirm is deleted after 7 days. Others are kept while your
order is open, and afterwards for as long as the law requires for business records. Email
justice@oceanlive.org to have yours deleted, or to ask what is held.

The legal basis in the EU and UK is taking steps at your request before entering into a
contract, and then performing it.

## Children

Ocean Live is meant for vehicle owners and is not directed at children.

## Changes

If this policy changes, the new version will be posted here with a new date.

## Contact

Questions: email justice@oceanlive.org, or open an issue at
https://github.com/JusticeRox98577/Fisker-Ocean-Apps/issues
