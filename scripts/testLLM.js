// scripts/testLLM.js
require('dotenv').config();
const { synthesizeInsights } = require('../services/llmInsights');

const sampleFacts = {
  "windowDays": 30,
  "personas": {
    "current": {
      "loyal": {
        "sessionCount": 24,
        "checkouts": 18,
        "revenue": 60714.18,
        "conversionRate": 0.75
      },
      "firsttime": {
        "sessionCount": 91,
        "checkouts": 14,
        "revenue": 1915100,
        "conversionRate": 0.15384615384615385
      },
      "active": {
        "sessionCount": 94,
        "checkouts": 14,
        "revenue": 1683500,
        "conversionRate": 0.14893617021276595
      },
      "guest": {
        "sessionCount": 12,
        "checkouts": 0,
        "revenue": 0,
        "conversionRate": 0
      }
    },
    "previous": {
      "loyal": {
        "sessionCount": 10,
        "checkouts": 6,
        "revenue": 936100,
        "conversionRate": 0.6
      },
      "firsttime": {
        "sessionCount": 104,
        "checkouts": 14,
        "revenue": 1094500,
        "conversionRate": 0.1346153846153846
      },
      "active": {
        "sessionCount": 86,
        "checkouts": 15,
        "revenue": 1966300,
        "conversionRate": 0.1744186046511628
      },
      "guest": {
        "sessionCount": 0,
        "checkouts": 0,
        "revenue": 0,
        "conversionRate": 0
      }
    }
  },
  "generic": {
    "current": {
      "overallConversionRate": 0.22072072072072071,
      "overallRevenue": 3662529.78,
      "overallSessionCount": 222,
      "deviceSplit": [
        {
          "_id": "Desktop",
          "count": 4634
        },
        {
          "_id": null,
          "count": 3459
        },
        {
          "_id": "Mobile",
          "count": 983
        },
        {
          "_id": "Tablet",
          "count": 86
        }
      ],
      "topProductCategory": "Sony PlayStation 5 Disc Edition (Phantom Black)",
      "bounceRate": 0.04054054054054054
    },
    "previous": {
      "overallConversionRate": 0.17073170731707318,
      "overallRevenue": 3996900,
      "overallSessionCount": 205,
      "deviceSplit": [
        {
          "_id": "Mobile",
          "count": 1069
        },
        {
          "_id": "Desktop",
          "count": 973
        },
        {
          "_id": "Tablet",
          "count": 211
        }
      ],
      "topProductCategory": "Belkin BoostCharge 2",
      "bounceRate": 0
    }
  }
};

(async () => {
  const insights = await synthesizeInsights(sampleFacts);
  console.log(JSON.stringify(insights, null, 2));
})();