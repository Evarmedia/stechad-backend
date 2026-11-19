const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireUuid = (id) => { if (!uuid.test(id || "")) throw Object.assign(new Error("Invalid identifier"), { status: 400 }); return id; };
const pagination = (query) => {
  const page = Number(query.page ?? 1), limit = Number(query.limit ?? 25);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error("Page must be positive and limit must be between 1 and 100"), { status: 400 });
  return { page, limit, offset: (page - 1) * limit };
};
const pageInfo = (count, page, limit) => ({ currentPage: page, itemsPerPage: limit, totalItems: count, totalPages: Math.ceil(count / limit) });
const asyncRoute = (handler) => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    const status = error.status || (error.name === "SequelizeUniqueConstraintError" ? 409 : error.name === "SequelizeValidationError" ? 400 : 500);
    if (status === 500) console.error("Request failed:", error);
    res.status(status).json({ success: false, message: status === 500 ? "Unable to complete this request" : error.message, ...(error.blockers ? { blockers: error.blockers } : {}) });
  }
};
module.exports = { requireUuid, pagination, pageInfo, asyncRoute };
