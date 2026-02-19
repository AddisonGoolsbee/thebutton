# Todo

## Stuff

- How to make it trustworthy that I won't manually change something in the end / that this is the true count and wasn't manipulated
- Come back to the tab after someone else has clicked a bunch -> instead of immediate update it scrolls up from previous amount to new amount. Do I want it to function like that?
- When you refresh the page it takes up to 3 seconds to catch up to the true count, even if you were the one who updated it
- Do something with metadata?

## Scaling (for when there are more users)

- **R2 for reads**: Write `count.json` to a public R2 bucket on each click batch. Frontend polls the R2 CDN URL instead of the worker. Reads served entirely from CDN — zero worker invocations for polling. R2 free tier: 1M writes/mo, 10M reads/mo (cache misses only).
- **Durable Objects for write batching**: Use a single Durable Object to accumulate clicks from all users in memory, flush to D1 every ~1 second. Turns N concurrent user writes into 1 D1 write/sec. Could combine with R2 — DO flushes to both D1 and R2 in one go.