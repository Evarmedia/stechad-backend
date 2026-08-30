const moment = require("moment");

const getKpiCriteria = (kpi) => {
  if (Array.isArray(kpi?.criteria) && kpi.criteria.length) {
    return kpi.criteria
      .filter((criterion) => criterion && String(criterion.title || "").trim())
      .map((criterion, index) => ({
        id: String(criterion.id || `criterion-${index + 1}`),
        title: String(criterion.title).trim(),
      }));
  }

  return String(kpi?.target || "")
    .split("\n")
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title, index) => ({ id: `legacy-${index + 1}`, title }));
};

const getKpiPeriod = (reviewCycle = "Monthly", value = new Date()) => {
  const date = moment(value).utcOffset(60);
  const cycle = String(reviewCycle).toLowerCase();

  if (cycle === "quarterly") {
    const quarter = Math.ceil((date.month() + 1) / 3);
    return { key: `${date.year()}-Q${quarter}`, label: `Q${quarter} ${date.year()}` };
  }
  if (cycle === "annual") return { key: String(date.year()), label: String(date.year()) };
  return { key: date.format("YYYY-MM"), label: date.format("MMMM YYYY") };
};

const formatKpiAppraisal = (appraisal) => ({
  id: appraisal.kpi_appraisal_id,
  periodKey: appraisal.period_key,
  periodLabel: appraisal.period_label,
  criteriaScores: Array.isArray(appraisal.criteria_scores) ? appraisal.criteria_scores : [],
  overallScore: Number(appraisal.overall_score),
  notes: appraisal.notes || "",
  recordedAt: appraisal.updated_at || appraisal.created_at,
});

module.exports = { getKpiCriteria, getKpiPeriod, formatKpiAppraisal };
