# What's new in Home it

## v1.3.0 (not released yet)

Start your car from the screen, with the heat set for the weather.

### New
- **Start the car.** A Car page on the big screen (swipe to it, or tap the Car card on Home), and a Car card on the phone, start a Hyundai with Bluelink (Canada). Home it picks 2 to 8 minutes, the inside temperature, defrost, rear window, heated wheel and seat from the weather outside. Snow adds time and defrost.
- **A short car page.** It shows what will happen and the button. Changing this start, your car's settings and past starts each open in the same page, with Back.
- **Change a start before you press (it's used once, then the weather's plan comes back),** and tell Home it once that you like it warmer or want it to run longer.
- The bottom cards on Home show a small arrow instead of "More" so their titles have room next to the new Car card.
- **Locks, fuel and doors.** A page shows whether the car is locked, fuel and range, open doors, trunk or hood, and tire or washer warnings, with Lock and Unlock buttons (Unlock asks twice). Checking doesn't wake the car.
- **Goodnight checks the car.** If the car is unlocked, Goodnight opens the lock page first; if it's locked, it says so.
- **"Start the car?"** On a cold or hot day, a few minutes before you need to leave for a shift, the screen chimes and asks. It never starts the car by itself.
- **Safe by design.** Press and hold to start, at most 3 starts an hour, Stop while it runs, a list of the last starts, and a wrong PIN stops at once so Bluelink doesn't lock it. Your Bluelink sign-in stays on the laptop.

## v1.2.0 (not released yet)

The big screen is now a set of full pages you swipe between.

### New
- **Swipe between pages.** Home, Today, Week, Weather, Money and News sit side by side. Swipe left or right, or tap a name at the bottom. Tapping a card on Home jumps to its page.
- **News.** Headlines from a news feed, newest first. Tap one to read its summary. It starts with CBC top stories; paste another feed's link in Settings, under Apps.
- **Week page.** Hours and pay by month next to what's coming up.
- **Money page.** Split it and Budget it side by side.

### Improved
- **Full pages instead of pop-ups.** Settings, shifts, events and a to-do's page now fill the screen, with Back in the corner.
- The screen goes back to Home by itself when it has been left alone.

### Fixed
- The update and screen scripts are marked as runnable in the repository, so the first update no longer stops with "This copy has changes of its own".

## v1.1.0

The bottom of the big screen is useful now, and the phone screen does more from its first page.

### New
- **Tap for a full page.** The bottom cards each say one thing. Tap one and its page opens; Back, or a tap beside the page, returns to the home screen. Settings, shifts and events open the same way.
- **Everything for today in one place.** Today's to-dos now sit inside the Today panel with your plans, and "All of today" opens a page with the shift, plans, to-dos and weather together. The list card keeps Later and Shopping.
- **Fuller pages.** Each page opens with the key numbers at the top. Today shows your shift, when to leave, what's left to do, the weather through the day and tomorrow. Coming up shows hours, pay and when to leave for every shift, with that day's weather. Split it adds recent expenses, and Budget it adds how each budget is doing.
- **Your calendar.** Paste the link of a shared Apple, Google or Outlook calendar in Settings and its events show on Today and Coming up. Home it only reads it.
- **Coming up.** The next thing on your schedule, and the next two weeks of shifts and events when you tap it. Also on the phone.
- **Next days' weather.** Tomorrow at a glance; tap for four days and the next hours.
- **Live money cards.** Link Split it and Budget it once and the screen shows what you're owed or owe, and what's safe to spend until payday with the bills before it. Company mode still hides them.
- **Edit anything.** To-dos, events and shifts can be changed after saving, on the big screen and the phone. To-dos can move between Today, Later and Shopping.
- **Repeating events.** Every week, month or year: rent, gym, birthdays. Tick one off and it comes back fresh next time.
- **Undo.** Removing a to-do by mistake can be taken back for a few seconds.
- **A warning when the screen is out of date.** If Home it or the weather can't be reached, the top bar says so instead of quietly showing old information.
- **Phone: add a to-do straight from Today,** with plans and to-dos in their own lists.
- **Hours and pay by month.** Tap the hours under the week to see this week, this month, the year so far and each of the last 12 months. Also on the phone, under Shifts. Good for checking a pay stub.
- **Move a shift to another day** when you edit it, instead of removing it and adding it again.
- **A second place for backups.** Set `BACKUP_COPY_DIR` to a USB stick or a synced folder and each day's copy goes there too.
- **More for AI assistants.** They can now rename or move a to-do, change a shift or an event, tick an event off, and read hours by month.

### Improved
- Cards with nothing to show are left out instead of showing an empty box. The TV and PS5 card is gone until it can do something.
- Long to-dos wrap onto a second line instead of being cut off.
- The marker on Today's timeline says NEXT, since it points at what's next.
- The guide no longer says goodnight on the phone.
- **A calmer home screen.** The day rail, the tomorrow chips and the progress bar are gone; Today is one clean list, and the details live on the pages.
- The bottom row is shorter, so Today, the to-do list and the week get more room.
- The leaving-soon checklist fits on one line.
- Settings are in tabs (Screen, Look, Work, Cards, Apps) instead of one long list.
- The same shift can't be added twice by tapping Save again.
- **Past shifts are kept for two years** (they used to go after 60 days, and events after a week), so old hours can be looked up.
- Money cards use plain numbers from Split it and Budget it when those apps send them, so a reworded sentence can't break a card.
- The big screen asks the browser to stay awake, and the screen script now also works on newer Linux desktops (Wayland).
- AI assistants can add repeating events too.
- Tests now run automatically on GitHub for every change.

### Fixed
- **Changing a repeating shift no longer rewrites the past.** The change starts on the day you picked; earlier weeks keep their hours and pay. A skipped day in the past also stays skipped.
- **Updates only take released versions.** Home it used to follow every change on the main branch within 10 minutes. It now waits for a release.
- **A bad update undoes itself.** After restarting, the updater checks that the app answers. If it doesn't, the old version comes back.

### Security
- The keys that link Split it and Budget it stay on the computer and are never sent to a screen.

## v1.0.0

The first version: a home screen for your day, made for an old laptop with a touch screen.

### New
- **Today.** Your shift is the headline, with the time to leave, a rail showing where you are in the day, and what else is on.
- **Shift soon.** In the last stretch before you have to leave, the panel turns into a countdown with a short checklist (keys, lunch, jacket, phone).
- **Shifts.** Add one-off shifts or ones that repeat every week, skip a day, copy last week, and see the week's hours and estimated pay.
- **To-do lists.** Today, Later and Shopping. Things can repeat daily or weekly. Finished ones clear themselves the next day.
- **Events.** Anything with a day and an optional time shows on Today and in the week.
- **Weather** for your town, from Open-Meteo. No account or key needed.
- **Guides.** Luffy or Hancock comment on your day and change mood with it.
- **Follows the clock.** Light by day, dark after sunset, fully dark at night, and a big clock when the screen is left alone.
- **A full-screen app.** Home it opens by itself when the laptop starts and takes over the whole screen, signed in, with its own on-screen keyboard for the touch screen. It only listens on the laptop itself unless you choose to share it.
- **A phone screen** of its own for adding and ticking to-dos, shifts and events on the go. Changes show on the big screen straight away.
- **Updates itself** from GitHub, checks the new version before switching, and reloads the screen.
- **AI assistant connector (MCP).** Connect an assistant like Claude and ask it about your day, or have it add to-dos, shifts and events. It signs in as you, and the screen updates as it works.
- **Company mode.** One tap hides the money cards until the next morning.
- **Every card can be switched off** in Settings, and the others fill the space.

### Security
- Invite-only sign-in, the same as Split it and Budget it. Passwords are hashed, wrong guesses are slowed down, and a new password signs every screen and assistant out.
- Everything is stored on your own computer. The only thing asked of the internet is the weather.

### Not in this version yet
- TV and PS5 controls, lights and plugs (they come through Home Assistant).
- Photos on the idle screen, reading shifts from a calendar link, and phone notifications.
