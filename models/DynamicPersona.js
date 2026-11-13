const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 projectId: { type: String, required: true }, slug: { type: String, required: true }, name: { type: String, required: true },
 environment: { type: String, enum: ['demo','production'], required: true },
 status: { type: String, enum: ['suggested','approved','dismissed','archived'], default: 'suggested' },
 rule: { type: mongoose.Schema.Types.Mixed, required: true }, revision: { type: Number, default: 1 },
 history: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
schema.index({projectId:1,environment:1,slug:1},{unique:true});
module.exports = mongoose.model('DynamicPersona',schema);
