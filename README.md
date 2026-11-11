# Home it

A home screen for your day, made for an old laptop with a touch screen. It shows your shift and when to leave, your to-do lists, what's on today, the week's hours and the weather, in the same comic look as [Split it](https://github.com/sherrypanaich/split-it) and Budget it.

It is one small Node.js app with no dependencies. Your data stays on your own computer in plain files.

## What it does

- **Today**: your shift, the time to leave, a rail of the day, and today's events. It turns into a countdown when it's nearly time to go.
- **Shifts**: one-off or repeating weekly, with the week's hours and estimated pay.
- **To-do lists**: Today, Later and Shopping, with things that repeat daily or weekly.
- **Weather** for your town (Open-Meteo, no key needed).
- **Follows the clock**: light by day, dark after sunset, fully dark at night, a big clock when left alone.
- **Guides**: Luffy or Hancock comment on your day.
- **Full screen**: opens as an app on the laptop at startup. It can also be opened from a phone if you choose to share it.

The Split it and Budget it cards show live numbers once you link those apps (both are optional):

```
node server.js mcp-key YOURNAME      # run this in the Split it (or Budget it) folder; it prints a key
node server.js link-split YOURNAME   # run this in the Home it folder; it asks for that app's address and the key
node server.js link-budget YOURNAME
```

To show a calendar you already keep (Apple, Google, Outlook), share it as a link and paste the `webcal://` or `https://` address under Settings, Apps. Home it reads it every 15 minutes and never writes to it.

Home it asks each app every few minutes, the same way an AI assistant would. The key is kept in `data/users.json` on your computer and never sent to a screen. `unlink-split` and `unlink-budget` undo it. See [CHANGELOG.md](CHANGELOG.md) for what's new.

## Start the car (Hyundai Bluelink, Canada)

Tap the **Car** card in the bottom row (or the Car card on the phone's Today) to warm up or cool down the car before you leave. Home it picks the run time and climate from the weather where you live:

| Feels like | Run time | Inside | Front defrost | Seat, wheel, rear window |
|---|---|---|---|---|
| below -10 °C | 8 min | 23 °C | on | on (seat high) |
| -10 to 0 °C | 6 min | 22 °C | on | on (seat medium) |
| 0 to 5 °C | 4 min | 22 °C | on if 3 °C or colder | on (seat low) |
| 5 to 15 °C | 2 min | 21 °C | off | off |
| 15 to 25 °C | 2 min | 21 °C (fan) | off | off |
| 25 to 30 °C | 4 min | 21 °C, cooling | off | cooled seat if your car has it |
| above 30 °C | 6 min | 20 °C, cooling | off | cooled seat if your car has it |

Snow or freezing rain adds 2 minutes and turns defrost on. Rain or fog turns defrost on. It never runs less than 2 or more than 8 minutes. Every start can be changed before you press, and "Your car" on the car page makes it warmer, cooler, shorter or longer every time, and says which seats and wheel your car can heat.

To set it up, open the car page and type your MyHyundai (Bluelink Canada) email, password and 4-number PIN. The first time, Hyundai sends you a code by email or text. They are saved only in `data/car.json` on this computer (readable by your user only) and only sent to Hyundai. "Remove the car from Home it" deletes them.

The car page also shows locks, fuel and doors (read from what the car last reported, which doesn't wake it), with Lock and Unlock. Goodnight checks the car is locked first. On cold or hot days, a few minutes before you need to leave for a shift, the screen chimes and asks "Start the car?" so you can open the car page.

Safety: you press and hold the button for a second to start (a tap does nothing), the car is never started by a timer, there are at most 3 starts an hour, a Stop button shows while it runs, and the last starts are listed with where they came from. If the PIN is wrong once, Home it stops and asks you to add the car again, so Bluelink never locks it. AI assistants cannot start the car. Don't use remote start in a closed garage.

This uses the same calls as the MyHyundai app, as the open-source [hyundai_kia_connect_api](https://github.com/Hyundai-Kia-Connect/hyundai_kia_connect_api) project documents them. It is not an official Hyundai API and can stop working if Hyundai changes it. The car needs an active Bluelink plan, must be locked, in Park, with the doors, hood and trunk shut.

## Try it without installing

```
node build-preview.js
```

Then open `preview/index.html`. It runs on sample data with a pretend clock you can move through the day.

## Install on a Linux computer

You need Node.js 22 or newer and git.

```
git clone https://github.com/sherrypanaich/home-it.git ~/home-it
cd ~/home-it
bash install.sh
node server.js add-user YOURNAME
```

Open http://localhost:8100 and sign in. The first person added runs it.

### Updates

Installed from git like this, Home it checks GitHub every 10 minutes. When a newer version has been released (a tag like `v1.1.0`) it switches to it, runs its self-check and restarts; the screen reloads by itself. If the self-check fails, or the app doesn't answer after the restart, the old version comes back and the bad one isn't tried again. Work in progress on `main` is never picked up. Your `data/` folder and `home-it.env` are never touched.

### Run it as a full-screen app on the laptop

```
bash install.sh YOURNAME
```

With your name added, the installer also puts Home it in the apps menu and opens it full screen every time the desktop starts: no address bar, no tabs, signed in as you. It needs Chromium or Chrome on the computer (`sudo apt install chromium`), and the computer set to log in automatically. Leave the screen with Alt+F4.

Out of the box Home it only listens on the computer itself (127.0.0.1), so nothing else on your network or the internet can open it. ### The phone screen

Phones get their own screen at `/phone` (opened automatically on a small screen): a quick way to add and tick to-dos, shifts and events with one thumb. To use it, set `HOST=0.0.0.0` in `home-it.env` and reach the laptop over something private like Tailscale, or a tunnel you trust. Anything changed on the phone shows on the big screen straight away.

### With Docker

```
docker compose up -d
docker compose exec home-it node server.js add-user YOURNAME
```

Set your time zone in `compose.yaml` (`TZ`), so "today" and the night hours match your clock.

## Connect an AI assistant (MCP)

Home it has a connector so an assistant such as Claude can answer "what's my day like?" or add a to-do, a shift or an event for you. It can read and change shifts, to-do lists and events. It can't change settings or passwords.

It needs the laptop to be reachable at an https address (see the phone screen above). Then either:

- give the assistant `https://YOUR-ADDRESS/mcp` and sign in with your Home it name and password when it asks, or
- for assistants that want a key: `node server.js mcp-key YOURNAME`, and send it as `Authorization: Bearer KEY`.

`node server.js mcp-revoke YOURNAME` signs every assistant out. So does changing your password.

## Settings

Most things are in the app under Settings: which cards show, the guide, colours, travel time to work, hourly pay, night hours, the idle clock and your town.

Optional server settings go in `home-it.env` (copy `home-it.env.example`): the port, your time zone, and the same sign-in extras as Split it (email links through Resend, Google sign-in).

## Commands

```
node server.js add-user NAME       add a person
node server.js set-password NAME   change a password (signs every screen out)
node server.js kiosk-link NAME     a one-time link that signs a screen in for good
node server.js sample NAME         fill an empty account with made-up data
node server.js list-users
node server.js link-split NAME     show Split it on the screen (also link-budget, unlink-split, unlink-budget)
node server.js mcp-key NAME        a key for an AI assistant
node server.js mcp-revoke NAME     sign every assistant out
```

## Your data

Everything is in the `data` folder: `db.json` (shifts, lists, events, settings) and `users.json` (accounts) and `oauth.json` (connected assistants), and `car.json` (your Bluelink sign-in, if you added the car). A copy of `db.json` is kept for each of the last 30 days in `data/backups`. Those copies sit on the same disk as the data, so set `BACKUP_COPY_DIR` in `home-it.env` to a USB stick or a folder that syncs somewhere else and each day's copy goes there too. Past shifts and events are kept for two years.

## Tests

```
node --test test/*.test.js
```

## Licence

MIT. The guide art in `public/art` is included with permission.
