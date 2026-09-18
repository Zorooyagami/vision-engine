// services/analyticsService.js
const Event = require("../models/Event");
// core metrics for a single time window/persona — shared by current + previous period calcs
async function coreMetrics(match, deviceType = 'all') {
const deviceTypeMap = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
}

const normalizedDeviceType =
  deviceTypeMap[deviceType?.toLowerCase()] || 'all'

const deviceMatch =
  normalizedDeviceType !== 'all'
    ? {
        ...match,
        'deviceInfo.deviceType': normalizedDeviceType,
      }
    : match

  const [purchaseAgg] = await Event.aggregate([
    {
      $match: {
        ...deviceMatch,
        event: 'purchase',
      },
    },
    {
      $group: {
        _id: null,
        revenue: {
          $sum: {
            $toDouble: '$properties.total',
          },
        },
        purchaseCount: {
          $sum: 1,
        },
      },
    },
  ])

  const [activityAgg] = await Event.aggregate([
    {
      $match: deviceMatch,
    },
    {
      $group: {
        _id: null,
        sessionIds: {
          $addToSet: '$sessionId',
        },
        userIds: {
          $addToSet: '$userId',
        },
      },
    },
  ])

  const revenue = purchaseAgg?.revenue || 0
  const purchaseCount = purchaseAgg?.purchaseCount || 0
  const sessionCount = activityAgg?.sessionIds?.length || 0
  const activeUsers =
    activityAgg?.userIds?.filter(Boolean).length || 0

  return {
    revenue: Number(revenue.toFixed(2)),
    activeUsers,
    conversionRate:
      sessionCount > 0
        ? Number(((purchaseCount / sessionCount) * 100).toFixed(2))
        : 0,
    avgOrderValue:
      purchaseCount > 0
        ? Number((revenue / purchaseCount).toFixed(2))
        : 0,
  }
}

function pctChange(current, previous) {
  if (previous === 0) {
    return current === 0 ? 0 : null
  }

  return Number(
    (((current - previous) / previous) * 100).toFixed(1)
  )
}

async function getKPIs(req, res) {
  
  try {
    const {
      period,
      persona,
      range,
      baseMatch,
      prevMatch,
    } = req.analytics
const deviceType = req.query.deviceType || 'all'
console.log('[analytics/kpis] deviceType:', deviceType)
    const current = await coreMetrics(
      baseMatch,
      deviceType
    )

    const previous = prevMatch
      ? await coreMetrics(
          prevMatch,
          deviceType
        )
      : null

    res.json({
      period,
      persona,
      deviceType: deviceType || 'all',
      range: range || 'all-time',

      kpis: {
        revenue: {
          value: current.revenue,
          change: previous
            ? pctChange(
                current.revenue,
                previous.revenue
              )
            : null,
        },

        activeUsers: {
          value: current.activeUsers,
          change: previous
            ? pctChange(
                current.activeUsers,
                previous.activeUsers
              )
            : null,
        },

        conversionRate: {
          value: current.conversionRate,
          change: previous
            ? pctChange(
                current.conversionRate,
                previous.conversionRate
              )
            : null,
        },

        avgOrderValue: {
          value: current.avgOrderValue,
          change: previous
            ? pctChange(
                current.avgOrderValue,
                previous.avgOrderValue
              )
            : null,
        },
      },
    })
  } catch (err) {
    console.error(
      '[analytics/kpis] failed:',
      err.message
    )

    res.status(400).json({
      error: err.message,
    })
  }
}

async function getRevenueTrend(req, res) {
  try {
    const { baseMatch } = req.analytics
    const { deviceType } = req.query

    const match = {
      ...baseMatch,
      event: "purchase"
    }

    // Optional device filter
    if (deviceType && ["mobile", "Desktop"].includes(deviceType)) {
      match["deviceInfo.deviceType"] = deviceType
    }

    const revenue = await Event.aggregate([
      {
        $match: match
      },
      {
        $addFields: {
          revenueAmount: {
            $convert: {
              input: "$properties.total",
              to: "double",
              onError: 0,
              onNull: 0
            }
          }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$timestamp"
            }
          },
          revenue: {
            $sum: "$revenueAmount"
          },
          orders: {
            $sum: 1
          }
        }
      },
      {
        $sort: {
          _id: 1
        }
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: 1,
          orders: 1
        }
      }
    ])

    const totalRevenue = revenue.reduce(
      (sum, item) => sum + item.revenue,
      0
    )

    const totalOrders = revenue.reduce(
      (sum, item) => sum + item.orders,
      0
    )

    res.json({
      deviceType: deviceType || "All",
      totalRevenue,
      totalOrders,
      trend: revenue
    })
  } catch (err) {
    console.error("[analytics/revenue-trend] failed:", err)

    res.status(500).json({
      error: err.message
    })
  }
}
module.exports = { getKPIs, getRevenueTrend }