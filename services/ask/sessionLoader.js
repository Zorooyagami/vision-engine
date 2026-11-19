'use strict';
const { STAGES } = require('./catalog');
// A bounded database-side session ordering path, used only for ordered funnels.
// The event projection excludes full URLs, IP addresses and unneeded properties.
function buildSessionPipeline(scope, windows, cap) {
  return [
    { $match: { projectId: scope.projectId, $or: windows.map(w => ({ timestamp: { $gte: w.start, $lt: w.end } })), event: { $in: [...STAGES, 'sign_up'] }, sessionId: { $type: 'string', $ne: '' } } },
    { $sort: { timestamp: 1 } },
    { $project: { _id: 0, event: 1, sessionId: 1, userId: 1, timestamp: 1, 'deviceInfo.deviceType': 1, browser: 1, trafficSource: 1, 'properties.total': 1, 'properties.currency': 1 } },
    { $group: { _id: '$sessionId', events: { $push: '$$ROOT' } } },
    { $unwind: '$events' },
    { $replaceRoot: { newRoot: '$events' } },
    { $sort: { timestamp: 1 } },
    { $limit: cap + 1 }
  ];
}
module.exports = { buildSessionPipeline };
