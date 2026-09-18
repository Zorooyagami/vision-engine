const Event = require("../models/Event");

console.log("[personaResolver] Event model:", Event.modelName);
console.log("[personaResolver] Event.aggregate:", typeof Event.aggregate);

async function resolvePersonaMatch(persona, range) {
  console.log("[personaResolver] persona:", persona);

  if (!persona || persona === "all") return {};

  if (persona === "guest") {
    return { userId: null };
  }

  if (persona === "loyal") {
    console.log(
      "[personaResolver] Before aggregate:",
      typeof Event.aggregate
    );

    const lifetimePurchases = await Event.aggregate([
      {
        $match: {
          event: "purchase",
          userId: { $ne: null }
        }
      },
      {
        $group: {
          _id: "$userId",
          purchaseCount: { $sum: 1 }
        }
      }
    ]);

    console.log(
      "[personaResolver] lifetimePurchases:",
      lifetimePurchases
    );

    const loyalIds = lifetimePurchases
      .filter((u) => u.purchaseCount >= 2)
      .map((u) => u._id);

    return {
      userId: { $in: loyalIds }
    };
  }

  if (persona === "firstTime") {
    const signupMatch = range
      ? {
          event: "sign_up",
          timestamp: {
            $gte: range.from,
            $lte: range.to
          }
        }
      : {
          event: "sign_up"
        };

    const signups = await Event.aggregate([
      { $match: signupMatch },
      { $group: { _id: "$userId" } }
    ]);

    return {
      userId: { $in: signups.map((s) => s._id) }
    };
  }

  if (persona === "active") {
    return {
      userId: { $ne: null }
    };
  }

  return {};
}

module.exports = { resolvePersonaMatch };