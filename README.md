# IndoorStats

Indoor volleyball stat tracker. Same look as BeachStats.

- Roster: hitters, setters, liberos. On-court players sit at the top.
- Hitters: serve, attack, pass rated − / 0 / #. Setters: serve only. Liberos: pass only.
- Efficiency for every skill: (# − −) / total.
- Score: sets to 25, 5th set to 15, best of 5. Optional auto-score from serve/attack stats.
- Subs: tap Sub on one player, then In/Out on the other. Libero swaps don't count.
- Everything saves in the browser. Roster is kept between matches.

## Run locally
npm install
npm run dev

## Deploy
Push to GitHub, import the repo in Vercel. It detects Vite automatically.
