/**
 * Stats Controller
 * ----------------
 * This is where dashboard-facing endpoints live. Starting with just
 * the funnel today — segmentation, anomaly detection, and AI summary
 * endpoints will get their own functions here as we build them
 * (Days 7-11 in the plan).
 */

const { getFunnel, getLoyalCustomer, getGamers, getUsersByPeriod } = require("../services/funnelService");

/**
 * GET /api/stats/funnel
 * Optional query params: startDate, endDate, deviceType, trafficSource
 */
async function funnel(req, res) {
  try {
    const { startDate, endDate, deviceType, trafficSource } = req.query;

    const data = await getFunnel({ startDate, endDate, deviceType, trafficSource });

    return res.json({ funnel: data });
  } catch (err) {
    console.error("[stats] funnel error:", err.message);
    return res.status(500).json({ error: "failed to compute funnel" });
  }
}

const personas = async (req, res) => {
  try {
    // Placeholder for personas logic
    const { startDate, endDate, deviceType, trafficSource } = req.query;

    // const loyalUsersPersona = await getLoyalCustomer({ startDate, endDate, deviceType, trafficSource });

    // const gamers = await getGamers({ startDate, endDate, deviceType, trafficSource });

    const users = await getUsersByPeriod(req.query.period)
    return res.json({ message: "Personas endpoint is under construction.", data: [
    //   {
    //   persona: "Loyal Customers",
    //   description: "Users who have made multiple purchases and show high engagement.",
    //   records: loyalUsersPersona[0],
    // },
     {
      persona: "User",
      description: "Users who frequently signed up.",
      records: users,
    },] });
  } catch (err) {
    console.error("[stats] personas error:", err.message);
    return res.status(500).json({ error: "failed to compute personas" });
  }
}

module.exports = { funnel, personas };

/*
for personas will he have time filters? like 1 day? 1 week? 1 month?


*/