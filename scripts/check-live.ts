import { defaultConfig } from "../lib/config";
import { liveProvider } from "../lib/provider";
import { getKorailBridge } from "../lib/korail-bridge";

// Explicit, one-shot real network check. Regular tests never query Korail.
async function main() {
  const config = defaultConfig();
  try {
    const trains = await liveProvider(config, AbortSignal.timeout(45000));
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          source: "korail-live",
          route: `${config.departure} → ${config.arrival}`,
          date: config.date,
          window: `${config.startTime}–${config.endTime}`,
          count: trains.length,
          trains: trains.map((t) => ({
            number: t.number,
            departure: t.departureTime,
            general: t.general,
            special: t.special,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    getKorailBridge().close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live check failed");
  process.exitCode = 1;
});
