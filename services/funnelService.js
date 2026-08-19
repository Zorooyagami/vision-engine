  /**
   * Funnel Service
   * --------------
   * Computes: how many sessions reached each stage of
   *   product_view -> add_to_cart -> checkout_start -> purchase
   *
   * This is the exact aggregation pattern we discussed: group all events
   * by sessionId, collect the unique event names per session, then count
   * how many sessions contain each funnel stage.
   *
   * NOTE for later: once this query gets slow (lots of data), this is a
   * good candidate to run periodically as a background job and cache the
   * result instead of computing it live on every dashboard request.
   */

  const Event = require("../models/Event");

  const FUNNEL_STAGES = ["product_view", "add_to_cart","remove_from_cart", "view_cart", "checkout_start", "purchase"];

  /**
   * @param {Object} filters - optional { startDate, endDate, deviceType, trafficSource }
   */
  async function getFunnel(filters = {}) {
    const match = {};

    if (filters.startDate || filters.endDate) {
      match.timestamp = {};
      if (filters.startDate) match.timestamp.$gte = new Date(filters.startDate);
      if (filters.endDate) match.timestamp.$lte = new Date(filters.endDate);
    }
    if (filters.deviceType) match.deviceType = filters.deviceType;
    if (filters.trafficSource) match.trafficSource = filters.trafficSource;

    const results = await Event.aggregate([
      { $match: match },
      {
        // Step 1: collapse events down to one document per session,
        // listing which event types occurred in it.
        $group: {
          _id: "$sessionId",
          eventTypes: { $addToSet: "$event" },
        },
      },
      {
        // Step 2: count, in parallel, how many sessions contain each stage.
        // $facet lets us run multiple independent counts in one query.
        $facet: {
          product_view: [{ $match: { eventTypes: "product_view" } }, { $count: "count" }],
          add_to_cart: [{ $match: { eventTypes: "add_to_cart" } }, { $count: "count" }],
          view_cart: [{ $match: { eventTypes: "view_cart" } }, { $count: "count" }],
          checkout_start: [{ $match: { eventTypes: "checkout_start" } }, { $count: "count" }],
          purchase: [{ $match: { eventTypes: "purchase" } }, { $count: "count" }],
        },
      },
    ]);

    // $facet returns counts nested like [{ count: 42 }] or [] if zero —
    // this just flattens that into clean numbers for the frontend.
    const raw = results[0] || {};
    const counts = {};
    for (const stage of FUNNEL_STAGES) {
      counts[stage] = raw[stage]?.[0]?.count || 0;
    }

    // Compute drop-off % between each consecutive stage.
    const stagesWithDropoff = FUNNEL_STAGES.map((stage, i) => {
      const count = counts[stage];
      const prevCount = i === 0 ? count : counts[FUNNEL_STAGES[i - 1]];
      const dropoffRate =
        i === 0 || prevCount === 0 ? 0 : Math.round((1 - count / prevCount) * 100);

      return { stage, count, dropoffRate };
    });

    return stagesWithDropoff;
  }


  const getLoyalCustomer = async (filters = {}) => {
      const loyalUsers = await Event.aggregate([
    // Stage 1: Filter purchase events
    {
      $match: {
        event: "purchase"
      }
    },
    
    // Stage 2: Group by userId to get order count and total revenue
    {
      $group: {
        _id: "$userId",
        orderCount: { $sum: 1 },
        revenue: { $sum: "$amount" } // Assuming amount field exists
      }
    },
    
    // Stage 3: Filter users with 2+ orders
    {
      $match: {
        orderCount: { $gte: 2 }
      }
    },
    
    // Stage 4: Sort by order count descending
    {
      $sort: {
        orderCount: -1
      }
    },
    
    // Stage 5: Get total number of unique users for percentage calculation
    {
      $facet: {
        // Get loyal users data
        users: [
          {
            $project: {
              _id: 0,
              userId: "$_id",
              orders: "$orderCount",
              revenue: 1
            }
          }
        ],
        // Get total user count for percentage calculation
        totalUsers: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 }
            }
          }
        ]
      }
    },
    
    // Stage 6: Format the final output
    {
      $project: {
        persona: { $literal: "loyal_user" },
        definition: { $literal: "2+ completed orders" },
        count: { $size: "$users" },
        users: "$users",
        totalUsers: { $arrayElemAt: ["$totalUsers.total", 0] }
      }
    },
    
    // Stage 7: Calculate percentage
    {
      $project: {
        persona: 1,
        definition: 1,
        count: 1,
        users: 1,
        totalUsers: 1,
        percentage: {
          $cond: {
            if: { $gt: ["$totalUsers", 0] },
            then: {
              $multiply: [
                { $divide: ["$count", "$totalUsers"] },
                100
              ]
            },
            else: 0
          }
        }
      }
    }
  ]);
  return loyalUsers;
  }


  const getGamers = async () => {
  const result = await Event.aggregate([
    {
      $match: {
        event: "purchase",
        "properties.products.subCategory": "Gaming"
      }
    }
  ]);
  return result;
};
  module.exports = { getFunnel, getLoyalCustomer, getGamers };
