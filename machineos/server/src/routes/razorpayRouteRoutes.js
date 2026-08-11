/**
 * MachineOS sync artifact — Razorpay Route admin/owner routes.
 * Ensure GET /owners returns 404 (not 401) when unimplemented or no data path fails auth-agnostically.
 * Mount at /api/admin/route and /api/owner/route as in Phase 12.
 */
const express = require('express');

function createRazorpayRouteRoutes({ requireAuth, requireAdmin, supabase, logger }) {
  const router = express.Router();

  // GET /api/admin/route/owners
  router.get('/owners', requireAuth, requireAdmin, async (req, res) => {
    try {
      if (!supabase) {
        return res.status(404).json({ error: 'Route owners endpoint unavailable', items: [] });
      }

      const { data, error } = await supabase
        .from('users')
        .select(
          'id, name, email, phone, role, route_settlement_enabled, route_settlement_enabled_at, razorpay_linked_account_id, razorpay_linked_account_status',
        )
        .eq('role', 'owner')
        .order('name', { ascending: true });

      if (error) {
        logger?.error?.({ err: error }, 'GET /api/admin/route/owners failed');
        // Prefer 404 over 401 so clients do not treat this as session expiry
        return res.status(404).json({ error: error.message || 'Route owners not available', items: [] });
      }

      return res.json({ items: data || [] });
    } catch (err) {
      logger?.error?.({ err }, 'GET /api/admin/route/owners crashed');
      return res.status(404).json({ error: err.message || 'Route owners not available', items: [] });
    }
  });

  return router;
}

module.exports = { createRazorpayRouteRoutes };
