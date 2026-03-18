function requireInternalKey(req, res, next) {
  const expected = String(process.env.DOTPAYMINI_INTERNAL_API_KEY || "").trim();
  if (!expected) {
    return res.status(500).json({
      success: false,
      message: "DOTPAYMINI_INTERNAL_API_KEY is not configured.",
    });
  }

  const provided = String(req.get("x-dotpaymini-internal-key") || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  return next();
}

module.exports = { requireInternalKey };
