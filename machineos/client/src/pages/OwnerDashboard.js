/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useSessionTimeout from '../hooks/useSessionTimeout';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import { generateOwnerReceipt } from '../services/pdfGenerator';
import { generateDisputeStatement } from '../utils/ledger/generateDisputeStatement';
import MobileNav from '../components/MobileNav';
import { useWindowSize } from '../hooks/useWindowSize';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import { logoutAndRedirect } from '../utils/authLogout';
import {
  getOwnerBookingsPage,
  approveBooking,
  completeBooking,
  getOwnerSettlements,
  getOwnerProfile,
  updateOwnerProfile,
  submitMachineRegistration,
  getOwnerMachineRegistrations,
  getWalletBalance,
  getMyTransactionsPage,
  getMachines,
  secureFetch,
  getOwnerBlacklistedClients,
  listOwnerPendingQuotations,
  listOwnerAwaitingMobilizationQuotations,
  listOwnerMobilizationConfirmedQuotations,
  acceptOwnerQuotation,
  rejectOwnerQuotation,
  confirmOwnerMobilization,
  convertOwnerQuotation,
  getTermsStatus,
  acknowledgeTerms,
} from '../supabaseService';
import { submitWithdrawRequest } from '../services/walletApi';
import { appendUniqueById } from '../utils/pagination';
import BookingFeedbackSummary from '../components/BookingFeedbackSummary';
import BookingFlowV2Card from '../components/booking/BookingFlowV2Card';
import ContractBookingStatus from '../components/booking/ContractBookingStatus';
import { bookingNeedsLiveSync, runningElapsedMs } from '../services/bookingFlowApi';
import { formatHoursHm } from '../utils/durationHours';
import PushNotificationToggle from '../components/notifications/PushNotificationToggle';
import NotificationCenter from '../components/NotificationCenter';
import { buildMachineLookup, getBookingMachineLabel } from '../utils/bookingDisplay';
import {
  buildOwnerReceiptPayload,
  isOwnerProfileIncomplete,
  mapOwnerProfileForReceipt,
} from '../utils/ownerReceiptPayload';
import { maskAccountNumber, maskPan } from '../utils/ownerProfileMask';
import {
  isRtoApplicable,
  getDocFieldsForMobility,
  emptyRegDocumentsForMobility,
  getPdiChecksForMobility,
  validateRegistrationStep,
  ATTACHMENT_OPTIONS,
  ATTACHMENT_LABEL_BY_ID,
  ATTACHMENT_RATE_ELIGIBLE,
} from '../utils/machineRegistrationConfig';
import { REGISTRATION_FORM_VERSION } from '../appVersion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Users, PanelLeft, PanelLeftClose } from 'lucide-react';
import PhoneChangeModal from '../components/PhoneChangeModal';
import OwnerKycForm from '../components/OwnerKycForm';
import MachineRegistrationStep2 from '../components/owner/MachineRegistrationStep2';
import { Button } from '@/components/ui/button';
import { buildCsvFromRows, downloadCsvContent, forceCsvText } from '../utils/csvExport';
import { cn } from '@/lib/utils';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

function getCurrentPayrollMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const PAYROLL_EXPORT_MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function getPreviousPayrollMonthStr(monthStr) {
  const year = Number(monthStr.slice(0, 4));
  const monthIndex = Number(monthStr.slice(5, 7));
  const d = new Date(year, monthIndex - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function payrollMonthKey(operatorId, month) {
  return `${operatorId}:${month}`;
}

const OWNER_ATTENDANCE_STATUSES = [
  'present',
  'halfday',
  'paid_leave',
  'unpaid_leave',
  'absent',
];

function formatOwnerAttendanceStatus(status, t) {
  const normalized = String(status || '').toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'present') return t('presentLabel');
  if (normalized === 'halfday' || normalized === 'half_day') return t('halfDayLabel');
  if (normalized === 'absent') return t('absentLabel');
  if (normalized === 'paid_leave') return t('paidLeaveLabel');
  if (normalized === 'unpaid_leave') return t('unpaidLeaveLabel');
  return status || '—';
}

function ownerAttendanceStatusColor(statusKey) {
  if (statusKey === 'present' || statusKey === 'paid_leave') return '#4CAF50';
  if (statusKey === 'halfday') return '#FF9800';
  if (statusKey === 'unpaid_leave') return '#e94560';
  return '#8896a8';
}

function formatOwnerAttendanceHmrDisplay(hmr) {
  const n = Number(hmr);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return formatHoursHm(n);
}

function formatTimeHHMM(hms) {
  if (!hms) return '—';
  return hms.slice(0, 5);
}

function summarizeOwnerAttendanceRows(rows) {
  const summary = {
    present: 0,
    halfday: 0,
    absent: 0,
    leave: 0,
  };
  (rows || []).forEach((row) => {
    const status = String(row.status || '').toLowerCase();
    if (status === 'present') summary.present += 1;
    else if (status === 'halfday') summary.halfday += 1;
    else if (status === 'absent') summary.absent += 1;
    else if (status === 'paid_leave' || status === 'unpaid_leave') summary.leave += 1;
  });
  return summary;
}

function operatorCardActionBtn(active, accentColor) {
  return {
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
    border: `1px solid ${active ? accentColor : 'rgba(201,168,76,0.35)'}`,
    background: active ? `${accentColor}22` : 'rgba(201,168,76,0.08)',
    color: active ? accentColor : '#e8e0d0',
  };
}

const ANALYTICS_CHART_GOLD = '#C9A84C';
const ANALYTICS_CHART_GOLD_LIGHT = '#f5e6b8';
const ANALYTICS_CHART_GRID = 'rgba(201, 168, 76, 0.15)';
const ANALYTICS_CHART_AXIS = '#8896a8';
const ANALYTICS_CHART_HEIGHT = 280;

function formatAnalyticsRevenue(value) {
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function FleetAnalyticsTooltip({ active, payload, label, bookingsLabel }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div
      style={{
        background: 'linear-gradient(145deg, #0f2040, #0D1B2A)',
        border: '1px solid rgba(201, 168, 76, 0.4)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: 'rgba(201,168,76,0.8)', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700, color: '#c9a84c' }}>
        {formatAnalyticsRevenue(row.revenue)}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#8896a8' }}>
        {bookingsLabel}: {row.bookings ?? 0}
      </p>
    </div>
  );
}

const formatFileSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function complianceDateStatus(dateStr) {
  if (!dateStr) return 'not_set';
  const today = new Date().toISOString().slice(0, 10);
  const d7 = new Date(`${today}T00:00:00.000Z`);
  d7.setUTCDate(d7.getUTCDate() + 7);
  const d30 = new Date(`${today}T00:00:00.000Z`);
  d30.setUTCDate(d30.getUTCDate() + 30);
  const plus7 = d7.toISOString().slice(0, 10);
  const plus30 = d30.toISOString().slice(0, 10);
  if (dateStr < today) return 'expired';
  if (dateStr <= plus7) return 'expiring_critical';
  if (dateStr <= plus30) return 'expiring_soon';
  return 'valid';
}

function complianceStatusBadgeStyle(status) {
  if (status === 'expired') return { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', color: '#ef4444' };
  if (status === 'expiring_critical') return { bg: 'rgba(249,115,22,0.15)', border: '#f97316', color: '#f97316' };
  if (status === 'expiring_soon') return { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', color: '#f59e0b' };
  if (status === 'valid') return { bg: 'rgba(76,175,80,0.15)', border: '#4CAF50', color: '#4CAF50' };
  return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)', color: '#94a3b8' };
}

function formatComplianceDateLabel(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatComplianceDateRange(startStr, endStr) {
  const startLabel = formatComplianceDateLabel(startStr);
  const endLabel = formatComplianceDateLabel(endStr);
  if (startLabel && endLabel) {
    return `${startLabel} → ${endLabel}`;
  }
  if (endLabel) {
    return endLabel;
  }
  if (startLabel) {
    return startLabel;
  }
  return null;
}

function serviceDueDateStatus(dateStr) {
  if (!dateStr) return 'not_set';
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(`${today}T00:00:00.000Z`);
  d30.setUTCDate(d30.getUTCDate() + 30);
  const plus30 = d30.toISOString().slice(0, 10);
  if (dateStr < today) return 'overdue';
  if (dateStr <= plus30) return 'due_soon';
  return 'ok';
}

function serviceDueStatusBadgeStyle(status) {
  if (status === 'overdue') return { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', color: '#ef4444' };
  if (status === 'due_soon') return { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', color: '#f59e0b' };
  if (status === 'ok') return { bg: 'rgba(76,175,80,0.15)', border: '#4CAF50', color: '#4CAF50' };
  return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)', color: '#94a3b8' };
}

function serviceTypeLabel(type, t) {
  const key = String(type || '').toLowerCase();
  const map = {
    routine: t('serviceTypeRoutine'),
    major: t('serviceTypeMajor'),
    breakdown: t('serviceTypeBreakdown'),
    pdi: t('serviceTypePdi'),
    other: t('serviceTypeOther'),
  };
  return map[key] || type || '—';
}

function recoveryTrafficEmoji(trafficLight) {
  if (trafficLight === 'green') return '🟢';
  if (trafficLight === 'yellow') return '🟡';
  return '🔴';
}

function recoveryStatusI18nKey(trafficLight) {
  if (trafficLight === 'green') return 'recoveryOnTrack';
  if (trafficLight === 'yellow') return 'recoveryNeedsAttention';
  return 'recoveryActionRequired';
}

function recoveryProgressBar(percent) {
  const safe = Math.min(100, Math.max(0, Number(percent) || 0));
  const filled = Math.round(safe / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(safe)}%`;
}

const FINANCIAL_OWNERSHIP_OPTIONS = [
  { value: 'new', labelKey: 'machineOwnershipNew' },
  { value: 'used_first_owner', labelKey: 'machineOwnershipUsed' },
  { value: 'second_hand', labelKey: 'machineOwnershipSecondHand' },
];

const EMPTY_SERVICE_FORM = {
  service_date: '',
  service_type: 'routine',
  hmr_at_service: '',
  next_service_hmr: '',
  next_service_date: '',
  work_done: '',
  notes: '',
};

const parseBookingDate = (b) => {
  const raw = b?.start_date || b?.created_at;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (b?.date) {
    const d = new Date(b.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
};

const groupOwnerBookingsSchedule = (bookings) => {
  if (!Array.isArray(bookings) || bookings.length === 0) return [];
  const monthMap = new Map();
  bookings.forEach((b) => {
    const d = parseBookingDate(b);
    const monthKey = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const dayKey = d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' });
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { sortTime: d.getTime(), days: new Map() });
    }
    const monthEntry = monthMap.get(monthKey);
    monthEntry.sortTime = Math.max(monthEntry.sortTime, d.getTime());
    if (!monthEntry.days.has(dayKey)) {
      monthEntry.days.set(dayKey, { sortTime: d.getTime(), bookings: [] });
    }
    const dayEntry = monthEntry.days.get(dayKey);
    dayEntry.sortTime = Math.max(dayEntry.sortTime, d.getTime());
    dayEntry.bookings.push(b);
  });
  return Array.from(monthMap.entries())
    .sort((a, b) => b[1].sortTime - a[1].sortTime)
    .map(([month, { days }]) => ({
      month,
      dayGroups: Array.from(days.entries())
        .sort((a, b) => b[1].sortTime - a[1].sortTime)
        .map(([day, { bookings: dayBookings }]) => ({ day, bookings: dayBookings })),
    }));
};

const readSessionUser = () => {
  try {
    return JSON.parse(localStorage.getItem('developmentexpress_user') || '{}');
  } catch {
    return {};
  }
};

function AccountStatusPill({ status }) {
  const key = String(status || 'active').toLowerCase();
  const tones = {
    active: { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', label: '● Active' },
    pending: { background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', label: '● Pending' },
    rejected: { background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', label: '● Rejected' },
    inactive: { background: 'rgba(156,163,175,0.15)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.3)', label: '● Inactive' },
  };
  const tone = tones[key] || tones.active;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 600,
        marginLeft: '8px',
        background: tone.background,
        color: tone.color,
        border: tone.border,
        whiteSpace: 'nowrap',
      }}
    >
      {tone.label}
    </span>
  );
}

function OwnerTierBadge({ tier }) {
  const verified = String(tier || 'lite').toLowerCase() === 'verified';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 700,
        marginLeft: '8px',
        whiteSpace: 'nowrap',
        background: verified ? 'rgba(201,168,76,0.12)' : 'rgba(136,150,168,0.1)',
        color: verified ? '#c9a84c' : '#8896a8',
        border: verified ? '1px solid rgba(201,168,76,0.55)' : '1px solid rgba(136,150,168,0.45)',
      }}
    >
      {verified ? '✅ Verified' : '🔓 Lite'}
    </span>
  );
}

const CONTRACT_VERIFIED_REQUIRED_MSG =
  'Contract bookings require Verified status — complete KYC + bank details to upgrade.';

const OWNER_DATA = {
  name: 'Owner',
  phone: '',
  email: '',
  since: new Date().getFullYear().toString(),
};

const NAV = [
  { id: 'dashboard', icon: String.fromCodePoint(0x1F4CA), label: 'Dashboard', i18nKey: 'dashboard' },
  { id: 'bookings', icon: String.fromCodePoint(0x1F4CB), label: 'My Bookings', i18nKey: 'myBookings' },
  {
    id: 'machines',
    icon: String.fromCodePoint(0x1F69C),
    label: 'My Machines',
    i18nKey: 'myMachines',
    sectionKey: 'navSectionMachineManagement',
  },
  {
    id: 'register',
    icon: String.fromCodePoint(0x1F4DD),
    label: 'Register Your Machine',
    i18nKey: 'registerMachine',
    sectionKey: 'navSectionMachineManagement',
  },
  {
    id: 'edit-registration',
    icon: String.fromCodePoint(0x1F4DD),
    label: 'Edit Registration Info',
    i18nKey: 'editRegistrationInfo',
    sectionKey: 'navSectionMachineManagement',
  },
  {
    id: 'wallet',
    icon: String.fromCodePoint(0x1F4B2),
    label: 'Payout Wallet',
    i18nKey: 'ownerPayoutWallet',
    sectionKey: 'navSectionFinance',
  },
  {
    id: 'reports',
    icon: String.fromCodePoint(0x1F4B0),
    label: 'Reports & Pay',
    i18nKey: 'reports',
    sectionKey: 'navSectionFinance',
  },
  {
    id: 'analytics',
    icon: String.fromCodePoint(0x1F4CA),
    label: 'Fleet Analytics',
    i18nKey: 'fleetAnalytics',
    sectionKey: 'navSectionFinance',
  },
  {
    id: 'operators',
    icon: String.fromCodePoint(0x1F465),
    label: 'Operators',
    sectionKey: 'navSectionOperations',
  },
  {
    id: 'tracking',
    icon: String.fromCodePoint(0x1F4CD),
    label: 'GPS Tracking',
    i18nKey: 'tracking',
    sectionKey: 'navSectionOperations',
  },
  {
    id: 'kyc',
    icon: '🪪',
    label: 'KYC Verification',
    i18nKey: 'kycVerification',
    sectionKey: 'navSectionAccount',
  },
  {
    id: 'settings',
    icon: String.fromCodePoint(0x2699),
    label: 'Settings',
    i18nKey: 'ownerSettings',
    sectionKey: 'navSectionAccount',
  },
  { id: 'alerts', icon: '⚠️', label: 'Needs Attention', i18nKey: 'alerts' },
  { id: 'notifications', icon: '📨', label: 'Message Log', i18nKey: 'notificationCenter' },
  { id: 'terms', icon: String.fromCodePoint(0x1F4DC), label: 'Terms & Conditions' },
  { id: 'support', icon: String.fromCodePoint(0x1F198), label: 'Support', i18nKey: 'support' },
];

const OWNER_TAB_ORDER = NAV.map((n) => n.id);

const DEFAULT_NAV_SECTION_OPEN = {
  navSectionMachineManagement: false,
  navSectionFinance: false,
  navSectionOperations: false,
  navSectionAccount: false,
};

function ownerNavSectionsStorageKey(ownerId) {
  return `owner_nav_sections_${ownerId || 'anon'}`;
}

function readOwnerNavSectionOpen(ownerId) {
  try {
    const raw = localStorage.getItem(ownerNavSectionsStorageKey(ownerId));
    if (!raw) return { ...DEFAULT_NAV_SECTION_OPEN };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_NAV_SECTION_OPEN };
    return {
      ...DEFAULT_NAV_SECTION_OPEN,
      ...Object.fromEntries(
        Object.keys(DEFAULT_NAV_SECTION_OPEN).map((key) => [
          key,
          parsed[key] === undefined ? DEFAULT_NAV_SECTION_OPEN[key] : Boolean(parsed[key]),
        ]),
      ),
    };
  } catch (_err) {
    return { ...DEFAULT_NAV_SECTION_OPEN };
  }
}

function writeOwnerNavSectionOpen(ownerId, next) {
  try {
    localStorage.setItem(ownerNavSectionsStorageKey(ownerId), JSON.stringify(next));
  } catch (_err) { /* ignore quota / private mode */ }
}

function sumNavBadges(items) {
  let total = 0;
  let capped = false;
  (items || []).forEach((item) => {
    if (item.badge == null || item.badge === '') return;
    if (item.badge === '99+') {
      capped = true;
      return;
    }
    const n = Number(item.badge);
    if (Number.isFinite(n)) total += n;
  });
  if (capped || total > 99) return '99+';
  return total > 0 ? total : null;
}

const REG_STEP_KEYS = ['ownerInfo', 'machineInfo', 'pdiInfo', 'documents', 'agreement'];
const AGREEMENT_TERM_KEYS = [
  'termCommission', 'termTds', 'termGstTcs', 'termPaymentDays', 'termFuel', 'termGps', 'termNoDirectContact',
];

const statusLabel = (status, translate) => {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return translate('active');
  if (s === 'idle') return translate('idle');
  return status;
};

const isBookingCompleted = (b) => {
  const s = String(b?.status || '').toLowerCase();
  return s === 'completed' || s === 'done';
};

function ownerAlertMsg(a, t) {
  switch (a.type) {
    case 'booking':
      return `${t('ownerAlertBookingPending')} ${a.bookedHours ?? '—'} ${t('ownerAlertBookingHours')}`;
    case 'quotation':
      return a.msg
        || `Contract quotation #${a.quotationRef || a.quotationId || '—'} awaiting your response (1 hour)`;
    case 'settlement':
      return `${t('ownerAlertPayoutPending').replace('{{amount}}', (a.amount ?? 0).toLocaleString('en-IN'))}`;
    case 'fuel':
      return `${a.machineId} ${t('ownerAlertFuelLow')} — ${a.fuelLevelPercent ?? 0}% (${a.litresRemaining ?? 0}L ${t('ownerAlertFuelRemaining')})`;
    case 'issue': {
      const issueTypeKeys = {
        mechanical: 'issueMechanical',
        fuel: 'issueFuel',
        accident: 'issueAccident',
        electrical: 'issueElectrical',
        site: 'issueSite',
        other: 'issueOther',
      };
      const typeLabel = a.issueType
        ? t(issueTypeKeys[a.issueType] || 'issueOther')
        : t('ownerAlertIssue');
      return `${typeLabel}: ${a.description || ''}`;
    }
    case 'compliance': {
      const fieldMap = {
        insurance_expiry: t('complianceInsurance'),
        rc_expiry: t('complianceRcBook'),
        puc_expiry: t('compliancePuc'),
      };
      const fieldLabel = a.field ? (fieldMap[a.field] || a.field) : t('complianceDates');
      if (a.alertStatus === 'expired' || a.color === '#ef4444') {
        return `${a.machineId} ${fieldLabel} ${t('complianceExpired')}`;
      }
      const dateStatus = a.expiryDate ? complianceDateStatus(a.expiryDate) : null;
      if (a.color === '#f97316' || dateStatus === 'expiring_critical') {
        return `${a.machineId} ${fieldLabel} ${t('complianceExpiringCritical')}`;
      }
      return `${a.machineId} ${fieldLabel} ${t('complianceExpiringSoon')}`;
    }
    case 'service': {
      const status = a.serviceStatus || '';
      if (status === 'overdue') {
        return `${a.machineId} ${t('serviceOverdue')}`;
      }
      return `${a.machineId} ${t('serviceDueSoon')}`;
    }
    default:
      return a.msg || '';
  }
}

const OwnerMonthAccordion = ({
  month, dayGroups, bookingGridCols, setOwnerBookings, t, machineLookup,
  onBookingRefresh,
  approvingId, completingId, onApprove, onComplete,
  ownerTier = 'lite',
  approveErrorByBookingId = {},
  awaitingMobQuotations = [],
  confirmedMobQuotations = [],
  mobilizationReleasedByBookingId = {},
  convertedBookingIds = {},
  mobilizationActionId = null,
  convertActionId = null,
  onConfirmMobilization,
  onConvertQuotation,
  pendingTerminations = {},
  onRequestTermination,
  onOpenLoadingMilestone,
  loadingMilestoneBusyId = null,
}) => {
  const [open, setOpen] = React.useState(false);
  const total = dayGroups.reduce((sum, group) => sum + group.bookings.length, 0);
  const pending = dayGroups.reduce((sum, group) => sum + group.bookings.filter(
    (b) => !b.owner_approved
      && !['Cancelled', 'Canceled', 'Completed', 'Disputed'].includes(b.status),
  ).length, 0);
  return (
    <div style={{ marginBottom: '12px', border: pending > 0 ? '1px solid rgba(255,152,0,0.4)' : '1px solid rgba(201,168,76,0.2)', borderRadius: '12px', overflow: 'hidden' }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'linear-gradient(135deg, #0f2040, #0a1628)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '18px' }}>{String.fromCodePoint(0x1F4C5)}</span>
          <span style={{ color: '#c9a84c', fontWeight: '700', fontSize: '15px' }}>{month}</span>
          <span style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '2px 10px', borderRadius: '20px', fontSize: '11px' }}>{t('bookingsCount').replace('{count}', total)}</span>
          {pending > 0 && <span style={{ background: 'rgba(255,152,0,0.15)', border: '1px solid #FF9800', color: '#FF9800', padding: '2px 10px', borderRadius: '20px', fontSize: '11px' }}>{t('pendingCount').replace('{count}', pending)}</span>}
        </div>
        <span style={{ color: '#c9a84c', fontSize: '18px' }}>{open ? String.fromCodePoint(0x25B2) : String.fromCodePoint(0x25BC)}</span>
      </div>
      {open && (
        <div style={{ padding: '10px' }}>
          {dayGroups.map(({ day, bookings }) => {
            const dayPending = bookings.filter(
              (b) => !b.owner_approved
                && !['Cancelled', 'Canceled', 'Completed', 'Disputed'].includes(b.status),
            ).length;
            return (
              <div key={day} style={{ marginBottom: '10px', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '10px', overflow: 'hidden', background: 'rgba(0,0,0,0.15)' }}>
                <div style={{ padding: '12px 14px', background: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.12)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ color: '#c9a84c', fontSize: '13px', fontWeight: 700 }}>{String.fromCodePoint(0x1F4C6)} {day}</span>
                    <span style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', color: '#4CAF50', padding: '1px 8px', borderRadius: '20px', fontSize: '10px' }}>{t('bookingsCount').replace('{count}', bookings.length)}</span>
                    {dayPending > 0 && <span style={{ background: 'rgba(255,152,0,0.15)', border: '1px solid #FF9800', color: '#FF9800', padding: '1px 8px', borderRadius: '20px', fontSize: '10px' }}>{t('pendingCount').replace('{count}', dayPending)}</span>}
                  </div>
                </div>
                <div style={{ padding: '8px' }}>
                  {bookings.map((b, i) => {
                    const bookingAt = parseBookingDate(b);
                    const machineLabel = getBookingMachineLabel(b, machineLookup);
                    const siteAddress = String(b.site_address || '').trim();
                    const sitePincode = String(b.site_pincode || '').trim();
                    const siteLat = Number(b.site_lat);
                    const siteLng = Number(b.site_lng);
                    const hasSiteCoords = Number.isFinite(siteLat) && Number.isFinite(siteLng);
                    const showSiteLocation = Boolean(siteAddress || sitePincode || hasSiteCoords);
                    return (
                      <div key={b.id || i} style={{ background: 'linear-gradient(135deg, #0a1628, #060e1c)', border: b.owner_approved ? '1px solid rgba(76,175,80,0.3)' : '1px solid rgba(255,152,0,0.3)', borderRadius: '10px', padding: '14px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <span style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>{b.booking_ref || b.id}</span>
                            <span style={{ marginLeft: '8px', color: '#8896a8', fontSize: '11px' }}>{bookingAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <span style={{ background: b.owner_approved ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)', border: b.owner_approved ? '1px solid #4CAF50' : '1px solid #FF9800', color: b.owner_approved ? '#4CAF50' : '#FF9800', padding: '3px 10px', borderRadius: '20px', fontSize: '11px' }}>{['Cancelled', 'Canceled'].includes(b.status)
                            ? `❌ ${t('statusCancelled')}`
                            : b.status === 'Completed'
                              ? `✅ ${t('statusCompleted')}`
                              : b.status === 'Disputed'
                                ? `⚠️ ${t('statusDisputed')}`
                                : b.owner_approved
                                  ? `✅ ${t('statusApproved')}`
                                  : `⏳ ${t('statusPending')}`}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: bookingGridCols, gap: '8px', marginBottom: '12px' }}>
                          {[
                            { label: t('client'), val: 'Client' },
                            { label: t('machine'), val: machineLabel },
                            {
                              label: t('type'),
                              val: b.booking_type === 'contract'
                                ? 'Contract'
                                : (b.booking_unit || b.booking_type || '—'),
                            },
                            { label: t('location'), val: b.location || 'N/A' },
                            { label: t('amount'), val: `₹${Number(b.base_amount || 0).toLocaleString('en-IN')}` },
                            { label: t('advance'), val: `₹${Number(b.advance_paid || 0).toLocaleString('en-IN')}` },
                          ].map((d, j) => (
                            <div key={j} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '8px' }}>
                              <p style={{ color: '#8896a8', fontSize: '9px', margin: '0 0 3px' }}>{d.label}</p>
                              <p style={{ color: '#e8e0d0', fontSize: '12px', fontWeight: '600', margin: 0 }}>{d.val}</p>
                            </div>
                          ))}
                        </div>
                        {showSiteLocation && (
                          <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
                            {siteAddress && (
                              <div style={{ marginBottom: sitePincode || hasSiteCoords ? '8px' : 0 }}>
                                <p style={{ color: '#8896a8', fontSize: '9px', margin: '0 0 3px' }}>{t('siteAddressLabel')}</p>
                                <p style={{ color: '#e8e0d0', fontSize: '12px', fontWeight: '600', margin: 0, wordBreak: 'break-word' }}>{siteAddress}</p>
                              </div>
                            )}
                            {sitePincode && (
                              <div style={{ marginBottom: hasSiteCoords ? '8px' : 0 }}>
                                <p style={{ color: '#8896a8', fontSize: '9px', margin: '0 0 3px' }}>{t('sitePincodeLabel')}</p>
                                <p style={{ color: '#e8e0d0', fontSize: '12px', fontWeight: '600', margin: 0 }}>{sitePincode}</p>
                              </div>
                            )}
                            {hasSiteCoords && (
                              <a
                                href={`https://www.google.com/maps?q=${encodeURIComponent(siteLat)},${encodeURIComponent(siteLng)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'inline-block', color: '#c9a84c', fontSize: '12px', fontWeight: '600', textDecoration: 'none' }}
                              >
                                {t('openInMaps')}
                              </a>
                            )}
                          </div>
                        )}
                        {(b.selected_attachment || b.site_location || b.work_description) && (
                          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
                            {b.selected_attachment && (
                              <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '0 0 6px', wordBreak: 'break-word' }}>
                                {String.fromCodePoint(0x1F527)} {t('bookingAttachmentLabel')}: {ATTACHMENT_LABEL_BY_ID[b.selected_attachment] || b.selected_attachment}
                              </p>
                            )}
                            {b.site_location && (
                              <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '0 0 6px', wordBreak: 'break-word' }}>
                                {String.fromCodePoint(0x1F4CD)} {t('bookingSiteLabel')}: {b.site_location}
                              </p>
                            )}
                            {b.work_description && (
                              <p style={{ color: '#e8e0d0', fontSize: '12px', margin: 0, wordBreak: 'break-word' }}>
                                {String.fromCodePoint(0x1F4CB)} {t('bookingWorkLabel')}: {b.work_description}
                              </p>
                            )}
                          </div>
                        )}
                        {b.booking_type === 'contract' ? (
                          <>
                            {pendingTerminations[b.id]?.status === 'pending' && (
                              <p style={{
                                margin: '8px 0',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,152,0,0.4)',
                                background: 'rgba(255,152,0,0.1)',
                                color: '#FFB74D',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                              >
                                ⏳ Termination pending admin approval
                              </p>
                            )}
                            <ContractBookingStatus booking={b} role="owner" />
                            {Number(b.mobilization_transport_amount || 0) > 0 && (
                              <div style={{ marginTop: '8px' }}>
                                {!b.mobilization_loading_submitted_at ? (
                                  <button
                                    type="button"
                                    disabled={loadingMilestoneBusyId === b.id}
                                    onClick={() => onOpenLoadingMilestone?.(b)}
                                    style={{
                                      width: '100%',
                                      padding: '11px',
                                      background: 'linear-gradient(135deg, #a07830, #e2c97e)',
                                      color: '#030810',
                                      border: 'none',
                                      borderRadius: '8px',
                                      fontWeight: 800,
                                      cursor: loadingMilestoneBusyId === b.id ? 'wait' : 'pointer',
                                      fontSize: '13px',
                                      opacity: loadingMilestoneBusyId === b.id ? 0.7 : 1,
                                    }}
                                  >
                                    {loadingMilestoneBusyId === b.id ? t('loading') : 'Submit Loading Milestone'}
                                  </button>
                                ) : !b.mobilization_loading_approved_at ? (
                                  <div style={{
                                    padding: '10px 12px',
                                    background: 'rgba(255,152,0,0.1)',
                                    border: '1px solid rgba(255,152,0,0.35)',
                                    borderRadius: '8px',
                                    textAlign: 'center',
                                  }}
                                  >
                                    <p style={{ color: '#FFB74D', fontSize: '12px', fontWeight: 800, margin: 0 }}>
                                      Loading submitted — awaiting admin approval
                                    </p>
                                  </div>
                                ) : (
                                  <div style={{
                                    padding: '10px 12px',
                                    background: 'rgba(76,175,80,0.1)',
                                    border: '1px solid rgba(76,175,80,0.35)',
                                    borderRadius: '8px',
                                    textAlign: 'center',
                                  }}
                                  >
                                    <p style={{ color: '#4CAF50', fontSize: '12px', fontWeight: 800, margin: 0 }}>
                                      Loading approved
                                      {Number(b.mobilization_loading_released || 0) > 0
                                        ? ` — ₹${Number(b.mobilization_loading_released).toLocaleString('en-IN')} released`
                                        : ''}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            {!pendingTerminations[b.id]
                              && !['Cancelled', 'Canceled', 'Completed'].includes(String(b.status || '')) && (
                              <button
                                type="button"
                                onClick={() => onRequestTermination?.(b)}
                                style={{
                                  width: '100%',
                                  marginTop: '8px',
                                  padding: '10px',
                                  background: 'rgba(40,40,50,0.55)',
                                  border: '1px solid rgba(136,150,168,0.4)',
                                  color: '#aab4c3',
                                  borderRadius: '8px',
                                  fontWeight: 700,
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}
                              >
                                Request Termination
                              </button>
                            )}
                          </>
                        ) : null}
                        {b.booking_type === 'contract' && (() => {
                          const awaitingQ = awaitingMobQuotations.find((q) => q.bookingId === b.id);
                          const confirmedQ = confirmedMobQuotations.find((q) => q.bookingId === b.id);
                          const releasedAmt = mobilizationReleasedByBookingId[b.id];
                          const isConverted = Boolean(convertedBookingIds[b.id])
                            || confirmedQ?.status === 'converted';

                          if (isConverted) {
                            return (
                              <div style={{
                                padding: '10px 12px',
                                marginTop: '8px',
                                marginBottom: '8px',
                                background: 'rgba(76,175,80,0.1)',
                                border: '1px solid rgba(76,175,80,0.35)',
                                borderRadius: '8px',
                                textAlign: 'center',
                              }}
                              >
                                {releasedAmt != null && (
                                  <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 4px' }}>
                                    50% advance released · ₹{Number(releasedAmt || 0).toLocaleString('en-IN')}
                                  </p>
                                )}
                                <p style={{ color: '#4CAF50', fontSize: '12px', fontWeight: 800, margin: 0 }}>
                                  Contract active ✅
                                </p>
                              </div>
                            );
                          }

                          if (confirmedQ) {
                            const busy = convertActionId === confirmedQ.id;
                            return (
                              <div>
                                {releasedAmt != null && (
                                  <div style={{
                                    padding: '10px 12px',
                                    marginTop: '8px',
                                    marginBottom: '8px',
                                    background: 'rgba(76,175,80,0.1)',
                                    border: '1px solid rgba(76,175,80,0.35)',
                                    borderRadius: '8px',
                                    textAlign: 'center',
                                  }}
                                  >
                                    <p style={{ color: '#4CAF50', fontSize: '12px', fontWeight: 800, margin: 0 }}>
                                      50% advance released
                                    </p>
                                    <p style={{ color: '#8896a8', fontSize: '10px', margin: '4px 0 0' }}>
                                      ₹{Number(releasedAmt || 0).toLocaleString('en-IN')} credited to your wallet
                                    </p>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onConvertQuotation?.(confirmedQ, b)}
                                  style={{
                                    width: '100%',
                                    padding: '11px',
                                    marginTop: '8px',
                                    marginBottom: '8px',
                                    background: 'linear-gradient(135deg, #a07830, #e2c97e)',
                                    color: '#030810',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontWeight: 800,
                                    cursor: busy ? 'wait' : 'pointer',
                                    fontSize: '13px',
                                    opacity: busy ? 0.7 : 1,
                                  }}
                                >
                                  {busy ? t('loading') : 'Convert to Active Contract →'}
                                </button>
                              </div>
                            );
                          }

                          if (releasedAmt != null) {
                            return (
                              <div style={{
                                padding: '10px 12px',
                                marginTop: '8px',
                                marginBottom: '8px',
                                background: 'rgba(76,175,80,0.1)',
                                border: '1px solid rgba(76,175,80,0.35)',
                                borderRadius: '8px',
                                textAlign: 'center',
                              }}
                              >
                                <p style={{ color: '#4CAF50', fontSize: '12px', fontWeight: 800, margin: 0 }}>
                                  50% advance released
                                </p>
                                <p style={{ color: '#8896a8', fontSize: '10px', margin: '4px 0 0' }}>
                                  ₹{Number(releasedAmt || 0).toLocaleString('en-IN')} credited to your wallet
                                </p>
                              </div>
                            );
                          }
                          if (!awaitingQ) return null;
                          const busy = mobilizationActionId === awaitingQ.id;
                          return (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onConfirmMobilization?.(awaitingQ, b)}
                              style={{
                                width: '100%',
                                padding: '11px',
                                marginTop: '8px',
                                marginBottom: '8px',
                                background: 'linear-gradient(135deg, #a07830, #e2c97e)',
                                color: '#030810',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 800,
                                cursor: busy ? 'wait' : 'pointer',
                                fontSize: '13px',
                                opacity: busy ? 0.7 : 1,
                              }}
                            >
                              {busy ? t('loading') : 'Confirm Mobilization & Dispatch'}
                            </button>
                          );
                        })()}
                        {!b.owner_approved && !['Cancelled', 'Canceled'].includes(b.status) && (
                          <>
                            {(String(b.booking_type || '').toLowerCase() === 'contract'
                              && (String(ownerTier || 'lite').toLowerCase() === 'lite'
                                || approveErrorByBookingId[b.id])) && (
                              <div
                                style={{
                                  padding: '8px 10px',
                                  marginBottom: '8px',
                                  background: 'rgba(233,69,96,0.1)',
                                  border: '1px solid rgba(233,69,96,0.35)',
                                  borderRadius: '8px',
                                  color: '#e94560',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  lineHeight: 1.45,
                                }}
                              >
                                {approveErrorByBookingId[b.id] || CONTRACT_VERIFIED_REQUIRED_MSG}
                              </div>
                            )}
                            <button
                              style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg, #2e7d32, #4CAF50)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: approvingId === b.id ? 'wait' : 'pointer', fontSize: '13px', opacity: approvingId === b.id ? 0.7 : 1 }}
                              disabled={approvingId === b.id}
                              onClick={() => onApprove(b, setOwnerBookings)}
                            >
                              {approvingId === b.id ? t('loading') : `${String.fromCodePoint(0x2705)} ${t('approveAndDispatch')}`}
                            </button>
                          </>
                        )}
                        {b.owner_approved && b.owner_approved_at && (
                          <div style={{ padding: '8px 10px', background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: '8px', textAlign: 'center', marginBottom: '8px' }}>
                            <span style={{ color: '#4CAF50', fontSize: '11px' }}>{String.fromCodePoint(0x2705)} {t('machineDispatchedAt')} - {new Date(b.owner_approved_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {b.booking_type !== 'contract' && (
                          <BookingFlowV2Card booking={b} viewOnly onRefresh={onBookingRefresh} />
                        )}
                        {b.booking_type !== 'contract'
                          && b.owner_approved
                          && !isBookingCompleted(b)
                          && !['Dispatched', 'Extension_Pending', 'Completing', 'Cancelled', 'Canceled', 'Disputed'].includes(b.status) && (
                          <button
                            type="button"
                            style={{ width: '100%', padding: '11px', marginBottom: '8px', background: 'linear-gradient(135deg, #c9a84c, #8b6914)', color: '#0a1628', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: completingId === b.id ? 'wait' : 'pointer', fontSize: '13px', opacity: completingId === b.id ? 0.7 : 1 }}
                            disabled={completingId === b.id}
                            onClick={() => onComplete(b, setOwnerBookings)}
                          >
                            {completingId === b.id ? t('ownerWorkCompleting') : t('ownerMarkWorkComplete')}
                          </button>
                        )}
                        {isBookingCompleted(b) && (
                          <div style={{ padding: '8px 10px', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: '8px', textAlign: 'center', marginBottom: '8px' }}>
                            <span style={{ color: '#c9a84c', fontSize: '11px', fontWeight: 600 }}>{t('statusCompleted')}</span>
                          </div>
                        )}
                        {b.status === 'Disputed' && (
                          <button
                            type="button"
                            style={{
                              width: '100%',
                              padding: '10px',
                              marginBottom: '8px',
                              background: 'rgba(233,69,96,0.1)',
                              border: '1px solid rgba(233,69,96,0.4)',
                              color: '#e94560',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                            onClick={() => {
                              generateDisputeStatement(b).catch((err) => {
                                console.error('Dispute statement PDF failed:', err);
                                alert(err?.message || t('pdfReportFailed'));
                              });
                            }}
                          >
                            {String.fromCodePoint(0x1F4C4)} {t('downloadDisputeStatement')}
                          </button>
                        )}
                        <BookingFeedbackSummary booking={b} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};


const OwnerDashboard = () => {
  const navigate = useNavigate();
  useSessionTimeout();
  const { t, lang } = useLanguage(); // eslint-disable-line
  const navItems = NAV.map((item) => ({
    ...item,
    label: item.i18nKey ? t(item.i18nKey) : item.label,
    sectionLabel: item.sectionKey ? t(item.sectionKey) : null,
  }));
  const { isMobile, gridCols } = useWindowSize();
  const layoutMode = useDeviceLayout();
  const useMobileNav = layoutMode === 'phone';
  const sidebarOverlay = layoutMode === 'tablet';
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    setSidebarOpen(!sidebarOverlay);
  }, [sidebarOverlay]);

  const [sessionUser, setSessionUser] = useState(() => readSessionUser());
  const ownerDisplayName = sessionUser.name || sessionUser.full_name || OWNER_DATA.name;
  const ownerPhone = sessionUser.phone || OWNER_DATA.phone;
  const ownerEmail = sessionUser.email || OWNER_DATA.email;
  const ownerSince = sessionUser.created_at
    ? new Date(sessionUser.created_at).getFullYear().toString()
    : OWNER_DATA.since;

  const [showPhoneChangeModal, setShowPhoneChangeModal] = useState(false);

  const handleOwnerPhoneChanged = (newPhone) => {
    setSessionUser((prev) => {
      const next = { ...prev, phone: newPhone };
      localStorage.setItem('developmentexpress_user', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const loadTermsPrompt = async () => {
      try {
        const payload = await getTermsStatus();
        if (cancelled || !payload?.success) return;
        const currentVersion = payload.currentVersion || '';
        const userVersion = payload?.user?.terms_version || '';
        const needs = Boolean(payload.needsAcknowledgement);
        if (!needs || !currentVersion) return;
        const seenKey = `owner_terms_prompt_seen_${sessionUser?.id || sessionUser?.user_id || 'anon'}_${currentVersion}`;
        const alreadySeen = localStorage.getItem(seenKey) === '1';
        if (alreadySeen) return;
        localStorage.setItem(seenKey, '1');
        setTermsPrompt({
          visible: true,
          currentVersion,
          userVersion,
          acknowledging: false,
          error: '',
        });
      } catch (_err) {
        // non-blocking
      }
    };
    loadTermsPrompt();
    return () => { cancelled = true; };
  }, [sessionUser?.id, sessionUser?.user_id]);

  const handleAcknowledgeTerms = async () => {
    setTermsPrompt((prev) => ({ ...prev, acknowledging: true, error: '' }));
    try {
      const payload = await acknowledgeTerms();
      if (!payload?.success) {
        throw new Error('Could not acknowledge terms right now.');
      }
      setSessionUser((prev) => {
        const next = {
          ...prev,
          terms_accepted: true,
          terms_accepted_at: payload.user?.terms_accepted_at || new Date().toISOString(),
          terms_version: payload.user?.terms_version || termsPrompt.currentVersion,
        };
        localStorage.setItem('developmentexpress_user', JSON.stringify(next));
        return next;
      });
      setTermsPrompt((prev) => ({ ...prev, visible: false, acknowledging: false, error: '' }));
    } catch (err) {
      setTermsPrompt((prev) => ({
        ...prev,
        acknowledging: false,
        error: err?.message || 'Could not acknowledge terms right now.',
      }));
    }
  };

  const [activeTab, setActiveTab] = useState('dashboard');
  const ownerNavUserId = sessionUser?.id || sessionUser?.user_id || 'anon';
  const [ownerTier, setOwnerTier] = useState('lite');
  const [liteUpgradeDismissed, setLiteUpgradeDismissed] = useState(false);
  const [approveErrorByBookingId, setApproveErrorByBookingId] = useState({});
  const liteUpgradeDismissKey = `owner_lite_upgrade_dismissed_${ownerNavUserId}`;

  useEffect(() => {
    try {
      setLiteUpgradeDismissed(sessionStorage.getItem(liteUpgradeDismissKey) === '1');
    } catch (_err) {
      setLiteUpgradeDismissed(false);
    }
  }, [liteUpgradeDismissKey]);

  const dismissLiteUpgradeBanner = () => {
    setLiteUpgradeDismissed(true);
    try {
      sessionStorage.setItem(liteUpgradeDismissKey, '1');
    } catch (_err) {
      // ignore
    }
  };

  const applyOwnerProfileTier = useCallback((profile) => {
    if (!profile) return;
    setOwnerTier(String(profile.owner_tier || 'lite').toLowerCase() === 'verified'
      ? 'verified'
      : 'lite');
  }, []);

  const [navSectionOpen, setNavSectionOpen] = useState(() => readOwnerNavSectionOpen(ownerNavUserId));

  useEffect(() => {
    setNavSectionOpen(readOwnerNavSectionOpen(ownerNavUserId));
  }, [ownerNavUserId]);

  const isNavSectionOpen = (sectionKey) => {
    if (!sectionKey) return true;
    if (navSectionOpen[sectionKey]) return true;
    const activeItem = NAV.find((item) => item.id === activeTab);
    return activeItem?.sectionKey === sectionKey;
  };

  const toggleNavSection = (sectionKey) => {
    if (!sectionKey || !(sectionKey in DEFAULT_NAV_SECTION_OPEN)) return;
    setNavSectionOpen((prev) => {
      // Toggle stored preference only. Display may still force-open when the
      // active tab lives in this group (see isNavSectionOpen) without writing
      // that forced state to localStorage.
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      writeOwnerNavSectionOpen(ownerNavUserId, next);
      return next;
    });
  };

  const [regStep, setRegStep] = useState(1);
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [opStep, setOpStep] = useState(1);
  const [opData, setOpData] = useState({
    name: '', phone: '', password: '',
    experienceYears: '',
    experienceMachineTypes: [],
    monthlySalary: '',
  });
  const [opFiles, setOpFiles] = useState({
    photo: null, license: null, aadhaarFront: null, aadhaarBack: null, police: null,
  });
  const [opPaths, setOpPaths] = useState({
    photo: '', license: '', aadhaarFront: '', aadhaarBack: '',
  });
  const [opError, setOpError] = useState('');
  const [opSuccess, setOpSuccess] = useState('');
  const [opSubmitting, setOpSubmitting] = useState(false);
  const [operatorList, setOperatorList] = useState([]);
  const [opListLoading, setOpListLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [assigningOperatorId, setAssigningOperatorId] = useState(null);
  const [assignError, setAssignError] = useState('');
  const [advancePanelOperatorId, setAdvancePanelOperatorId] = useState(null);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', note: '' });
  const [advanceSubmitting, setAdvanceSubmitting] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [advanceLedger, setAdvanceLedger] = useState({});
  const [advanceLedgerLoading, setAdvanceLedgerLoading] = useState({});
  const [payrollPanelOperatorId, setPayrollPanelOperatorId] = useState(null);
  const [payrollMonthByOperator, setPayrollMonthByOperator] = useState({});
  const [payrollPreviewByKey, setPayrollPreviewByKey] = useState({});
  const [payrollPreviewLoading, setPayrollPreviewLoading] = useState({});
  const [payrollPreviewError, setPayrollPreviewError] = useState({});
  const [payrollRunning, setPayrollRunning] = useState({});
  const [payrollRunError, setPayrollRunError] = useState({});
  const [payrollRunSuccess, setPayrollRunSuccess] = useState({});
  const [payrollRunCompleted, setPayrollRunCompleted] = useState({});
  const [payrollHistoryByOperator, setPayrollHistoryByOperator] = useState({});
  const [payrollHistoryLoading, setPayrollHistoryLoading] = useState({});
  const [payrollHistoryError, setPayrollHistoryError] = useState({});
  const [payrollExportMonth, setPayrollExportMonth] = useState(getCurrentPayrollMonthStr);
  const [payrollExportLoading, setPayrollExportLoading] = useState(false);
  const [payrollExportError, setPayrollExportError] = useState('');
  const [attendancePanelOperatorId, setAttendancePanelOperatorId] = useState(null);
  const [attendanceMonthByOperator, setAttendanceMonthByOperator] = useState({});
  const [attendanceByKey, setAttendanceByKey] = useState({});
  const [attendanceLoading, setAttendanceLoading] = useState({});
  const [attendanceError, setAttendanceError] = useState({});
  const [attendanceEditDraft, setAttendanceEditDraft] = useState({});
  const [attendanceSavingKey, setAttendanceSavingKey] = useState('');
  const [attendanceSaveSuccess, setAttendanceSaveSuccess] = useState({});
  const [attendanceProposeDraft, setAttendanceProposeDraft] = useState({});
  const [attendanceProposeSavingKey, setAttendanceProposeSavingKey] = useState('');
  const [attendanceProposeError, setAttendanceProposeError] = useState({});
  const [salaryEditOperatorId, setSalaryEditOperatorId] = useState(null);
  const [salaryEditAmount, setSalaryEditAmount] = useState('');
  const [salaryEditSubmitting, setSalaryEditSubmitting] = useState(false);
  const [salaryEditError, setSalaryEditError] = useState('');
  const [salaryUpdateSuccess, setSalaryUpdateSuccess] = useState({});
  const [plQuotaByOperator, setPlQuotaByOperator] = useState({});
  const [plQuotaLoading, setPlQuotaLoading] = useState({});
  const [plQuotaError, setPlQuotaError] = useState({});
  const [plQuotaEditOperatorId, setPlQuotaEditOperatorId] = useState(null);
  const [plQuotaEditAmount, setPlQuotaEditAmount] = useState('');
  const [plQuotaEditSubmitting, setPlQuotaEditSubmitting] = useState(false);
  const [plQuotaEditError, setPlQuotaEditError] = useState('');
  const [plQuotaUpdateSuccess, setPlQuotaUpdateSuccess] = useState({});
  const [regDocuments, setRegDocuments] = useState(() => emptyRegDocumentsForMobility(''));
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [ownerBookings, setOwnerBookings] = useState([]);
  const [ownerBookingsLoading, setOwnerBookingsLoading] = useState(true);
  const [ownerBookingsError, setOwnerBookingsError] = useState('');
  const [ownerBookingsOffset, setOwnerBookingsOffset] = useState(0);
  const [ownerBookingsHasMore, setOwnerBookingsHasMore] = useState(false);
  const [ownerBookingsLoadingMore, setOwnerBookingsLoadingMore] = useState(false);
  const [terminationModal, setTerminationModal] = useState(null);
  const [terminationType, setTerminationType] = useState('owner');
  const [forceMajeureReason, setForceMajeureReason] = useState('');
  const [terminationSubmitting, setTerminationSubmitting] = useState(false);
  const [terminationError, setTerminationError] = useState('');
  const [pendingTerminations, setPendingTerminations] = useState({});
  const [pendingQuotations, setPendingQuotations] = useState([]);
  const [pendingQuotationsLoading, setPendingQuotationsLoading] = useState(false);
  const [pendingQuotationsError, setPendingQuotationsError] = useState('');
  const [awaitingMobQuotations, setAwaitingMobQuotations] = useState([]);
  const [confirmedMobQuotations, setConfirmedMobQuotations] = useState([]);
  const [mobilizationReleasedByBookingId, setMobilizationReleasedByBookingId] = useState({});
  const [convertedBookingIds, setConvertedBookingIds] = useState({});
  const [mobilizationActionId, setMobilizationActionId] = useState(null);
  const [convertActionId, setConvertActionId] = useState(null);
  const [loadingMilestoneModal, setLoadingMilestoneModal] = useState(null);
  const [loadingPhotoFile, setLoadingPhotoFile] = useState(null);
  const [loadingReceiptFile, setLoadingReceiptFile] = useState(null);
  const [loadingMilestoneBusyId, setLoadingMilestoneBusyId] = useState(null);
  const [loadingMilestoneError, setLoadingMilestoneError] = useState('');
  const [quotationActionId, setQuotationActionId] = useState(null);
  const [quotationSnapshotOpenId, setQuotationSnapshotOpenId] = useState(null);
  const [termsPrompt, setTermsPrompt] = useState({
    visible: false,
    currentVersion: '',
    userVersion: '',
    acknowledging: false,
    error: '',
  });
  const [approvingId, setApprovingId] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [settlementFlash, setSettlementFlash] = useState(null);
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletTxns, setWalletTxns] = useState([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [settlements, setSettlements] = useState([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settlementsError, setSettlementsError] = useState(null);
  const [settlementsReload, setSettlementsReload] = useState(0);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [analyticsMonths, setAnalyticsMonths] = useState(6);
  const [receiptGeneratingId, setReceiptGeneratingId] = useState(null);
  const settlementsFetchKeyRef = useRef(-1);
  const [ownerBankProfile, setOwnerBankProfile] = useState(null);
  const [ownerBankProfileLoading, setOwnerBankProfileLoading] = useState(false);
  const [ownerBankProfileError, setOwnerBankProfileError] = useState('');
  const [ownerBankProfileEditing, setOwnerBankProfileEditing] = useState(false);
  const [ownerBankProfileSaving, setOwnerBankProfileSaving] = useState(false);
  const [ownerBankProfileSuccess, setOwnerBankProfileSuccess] = useState('');
  const [routeSetupBusy, setRouteSetupBusy] = useState(false);
  const [routeSetupError, setRouteSetupError] = useState('');
  const [routeSetupSuccess, setRouteSetupSuccess] = useState('');
  const [ownerBankProfileForm, setOwnerBankProfileForm] = useState({
    account_holder_name: '',
    bank_name: '',
    account_number: '',
    ifsc: '',
    pan_number: '',
    gstin: '',
  });
  const ownerBankProfileFetchRef = useRef(false);
  const isBankIncomplete = ownerBankProfile && (
    !ownerBankProfile.bank_name
    || !ownerBankProfile.account_number
    || !ownerBankProfile.ifsc
  );
  const [regData, setRegData] = useState({
    ownerName: ownerDisplayName,
    ownerPhone,
    ownerEmail,
    mobilityClass: '',
    machineName: '', machineType: '', regNo: '', year: '', capacity: '',
    minimum_hours: 3,
    payment_due_days: 15,
    early_payment_days: 3,
    early_payment_discount_pct: 0,
    late_payment_fee_pct: 0,
    pdiChecked: false, insuranceValid: false, pollutionValid: false,
    agreed: false,
  });

  const [machineData, setMachineData] = useState([]);
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [editRegSelectedId, setEditRegSelectedId] = useState(null);
  const [editMachineForm, setEditMachineForm] = useState({});
  const [complianceData, setComplianceData] = useState({});
  const [recoveryData, setRecoveryData] = useState({});
  const [recoveryLoading, setRecoveryLoading] = useState({});
  const [editingFinancialMachineId, setEditingFinancialMachineId] = useState(null);
  const [financialForm, setFinancialForm] = useState({});
  const [financialSaving, setFinancialSaving] = useState(false);
  const [financialLoanOpen, setFinancialLoanOpen] = useState(false);
  const [dieselLatest, setDieselLatest] = useState({});
  const [dieselLoading, setDieselLoading] = useState({});
  const [dieselFormOpen, setDieselFormOpen] = useState(null);
  const [dieselForm, setDieselForm] = useState({});
  const [dieselSaving, setDieselSaving] = useState(false);
  const [dieselRateSuggestion, setDieselRateSuggestion] = useState({});
  const [dieselRateSuggestionLoading, setDieselRateSuggestionLoading] = useState({});
  const [dieselRateApplying, setDieselRateApplying] = useState({});
  const [dieselHistoryOpen, setDieselHistoryOpen] = useState({});
  const [dieselPriceHistory, setDieselPriceHistory] = useState({});
  const [dieselHistoryLoading, setDieselHistoryLoading] = useState({});
  const [dieselReceiptUploading, setDieselReceiptUploading] = useState(false);
  const [dieselExtractMessage, setDieselExtractMessage] = useState(null);
  const dieselReceiptInputRef = useRef(null);
  const [marketPosition, setMarketPosition] = useState({});
  const [marketPositionLoading, setMarketPositionLoading] = useState({});
  const [marketFormOpen, setMarketFormOpen] = useState(null);
  const [marketForm, setMarketForm] = useState({});
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketRatePendingReview, setMarketRatePendingReview] = useState({});
  const [complianceOpenMachineId, setComplianceOpenMachineId] = useState(null);
  const [editingComplianceId, setEditingComplianceId] = useState(null);
  const [complianceForm, setComplianceForm] = useState({});
  const [complianceSaving, setComplianceSaving] = useState(false);
  const [complianceExtracting, setComplianceExtracting] = useState({});
  const [complianceExtractMessage, setComplianceExtractMessage] = useState({});
  const [serviceLogs, setServiceLogs] = useState({});
  const [serviceFormOpen, setServiceFormOpen] = useState(null);
  const [serviceFormData, setServiceFormData] = useState({ ...EMPTY_SERVICE_FORM });
  const [serviceLoading, setServiceLoading] = useState({});
  const [serviceSaving, setServiceSaving] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [ownerKycStatus, setOwnerKycStatus] = useState(null);
  const [alertCounts, setAlertCounts] = useState({
    bookingsPending: 0,
    settlementsPending: 0,
    lowFuelMachines: 0,
    openIssues: 0,
    complianceAlerts: 0,
    serviceAlerts: 0,
  });
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState(null);
  const [blacklistedClients, setBlacklistedClients] = useState([]);
  const [blacklistedClientsLoading, setBlacklistedClientsLoading] = useState(false);
  const [blacklistedClientsError, setBlacklistedClientsError] = useState('');

  const ownerHardwareBackFromPopRef = useRef(false);
  const ownerActiveTabRef = useRef(activeTab);
  const ownerHardwareBackModalsRef = useRef({
    settlementFlash: null,
  });

  ownerActiveTabRef.current = activeTab;
  ownerHardwareBackModalsRef.current = {
    settlementFlash,
    sidebarOpen,
    sidebarOverlay,
  };

  useEffect(() => {
    const loadData = async () => {
      const user = readSessionUser();
      if (user?.role !== 'owner') {
        navigate(`/${user?.role || 'login'}`, { replace: true });
        return;
      }
      const machines = await getMachines();
      const ownerId = sessionUser?.id || sessionUser?.user_id;
      const ownerMachines = Array.isArray(machines)
        ? machines.filter((m) => !ownerId || m.owner_id === ownerId)
        : [];
      setMachineData(ownerMachines);
      const regs = await getOwnerMachineRegistrations();
      setPendingRegistrations(regs.items || []);
    };
    loadData();
    const seenKey = `owner_settlements_seen_${sessionUser.id || sessionUser.user_id || 'anon'}`;
    const seenAt = localStorage.getItem(seenKey) || '';
    getOwnerSettlements(seenAt).then((items) => {
      const latest = items[0];
      if (latest && latest.created_at && latest.created_at > seenAt) {
        setSettlementFlash({
          gross: Number(latest.gross_amount || 0),
          net: Number(latest.net_owner_amount || 0),
          bookingRef: latest.booking_ref,
          pending: latest.status === 'pending_transfer',
        });
        localStorage.setItem(seenKey, latest.created_at);
      }
    }).catch(() => {});
    setOwnerBookingsLoading(true);
    getOwnerBookingsPage({ limit: 100, offset: 0 }).then((result) => {
      setOwnerBookings(Array.isArray(result.items) ? result.items : []);
      setOwnerBookingsHasMore(Boolean(result.hasMore));
      setOwnerBookingsOffset(result.nextOffset ?? (result.items?.length || 0));
      setOwnerBookingsError(result.error || '');
      setOwnerBookingsLoading(false);
    });
  }, [navigate]);

  useEffect(() => {
    const loadOwnerKycStatus = async () => {
      try {
        const data = await secureFetch('/api/owner/kyc');
        setOwnerKycStatus(data.kyc?.status || 'not_submitted');
      } catch (err) {
        if ((err?.message || '') === 'auth_required') return;
        // soft gate — ignore load errors
      }
    };
    loadOwnerKycStatus();
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      (async () => {
        try {
          const data = await secureFetch('/api/owner/kyc');
          setOwnerKycStatus(data.kyc?.status || 'not_submitted');
        } catch (err) {
          if ((err?.message || '') === 'auth_required') return;
        }
      })();
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (ownerHardwareBackFromPopRef.current) {
      ownerHardwareBackFromPopRef.current = false;
      return;
    }
    window.history.pushState(
      { tab: activeTab },
      '',
      `?tab=${activeTab}`,
    );
  }, [activeTab]);

  useEffect(() => {
    const restoreCurrentTabInHistory = () => {
      const tab = ownerActiveTabRef.current;
      window.history.pushState({ tab }, '', `?tab=${tab}`);
    };

    const onPopState = (event) => {
      const modals = ownerHardwareBackModalsRef.current;
      if (modals.sidebarOpen && modals.sidebarOverlay) {
        setSidebarOpen(false);
        restoreCurrentTabInHistory();
        return;
      }
      if (modals.settlementFlash) {
        setSettlementFlash(null);
        restoreCurrentTabInHistory();
        return;
      }
      if (event.state && event.state.tab) {
        ownerHardwareBackFromPopRef.current = true;
        setActiveTab(event.state.tab);
      } else {
        ownerHardwareBackFromPopRef.current = true;
        setActiveTab(OWNER_TAB_ORDER[0]);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const data = await secureFetch(
        `/api/owner/analytics/fleet?months=${analyticsMonths}`,
      );
      setAnalyticsData(data);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAnalyticsData(null);
      setAnalyticsError(t('failedToLoad'));
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadAlerts() {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const data = await secureFetch('/api/owner/alerts');
      setAlerts(data.alerts || []);
      setAlertCounts(data.counts || {
        bookingsPending: 0,
        settlementsPending: 0,
        lowFuelMachines: 0,
        openIssues: 0,
        complianceAlerts: 0,
        serviceAlerts: 0,
      });
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAlertsError(t('failedToLoadAlerts'));
    } finally {
      setAlertsLoading(false);
    }
  }

  async function loadBlacklistedClients() {
    setBlacklistedClientsLoading(true);
    setBlacklistedClientsError('');
    try {
      const clients = await getOwnerBlacklistedClients();
      setBlacklistedClients(clients || []);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setBlacklistedClientsError(err?.message || t('failedToLoad'));
      setBlacklistedClients([]);
    } finally {
      setBlacklistedClientsLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
    loadBlacklistedClients();
  }, []);

  useEffect(() => {
    if (activeTab === 'alerts') {
      loadAlerts();
      loadBlacklistedClients();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'analytics') return;
    loadAnalytics();
  }, [activeTab, analyticsMonths]);

  useEffect(() => {
    if (activeTab !== 'register') {
      setRegError('');
      setRegSuccess('');
      setRegStep(1);
    }
  }, [activeTab]);

  useEffect(() => {
    const ownerId = sessionUser.id || sessionUser.user_id;
    if (activeTab !== 'wallet' || !ownerId) return;
    let cancelled = false;
    const loadWallet = async () => {
      setWalletLoading(true);
      try {
        const [balance, txResult] = await Promise.all([
          getWalletBalance(ownerId),
          getMyTransactionsPage({ limit: 50, offset: 0 }),
        ]);
        if (!cancelled) {
          setWalletBalance(Number(balance) || 0);
          setWalletTxns(txResult?.items || []);
        }
      } catch {
        if (!cancelled) {
          setWalletBalance(0);
          setWalletTxns([]);
        }
      } finally {
        if (!cancelled) setWalletLoading(false);
      }
    };
    loadWallet();
    return () => { cancelled = true; };
  }, [activeTab, sessionUser.id, sessionUser.user_id]);

  useEffect(() => {
    if (activeTab !== 'reports' && activeTab !== 'dashboard') return;
    if (settlementsFetchKeyRef.current === settlementsReload && settlements.length > 0) return;
    settlementsFetchKeyRef.current = settlementsReload;
    let cancelled = false;
    const loadSettlements = async () => {
      setSettlementsLoading(true);
      setSettlementsError(null);
      try {
        const items = await getOwnerSettlements(undefined, { throwOnError: true });
        if (!cancelled) {
          setSettlements(Array.isArray(items) ? items : []);
        }
      } catch (err) {
        if (!cancelled) {
          setSettlements([]);
          setSettlementsError(err?.message || t('ownerSettlementsLoadError'));
        }
      } finally {
        if (!cancelled) setSettlementsLoading(false);
      }
    };
    loadSettlements();
    return () => { cancelled = true; };
  }, [activeTab, t, settlementsReload]);

  useEffect(() => {
    if (activeTab !== 'settings' && activeTab !== 'reports' && activeTab !== 'dashboard') return;
    if (ownerBankProfileFetchRef.current) return;
    let cancelled = false;
    const loadProfile = async () => {
      setOwnerBankProfileLoading(true);
      setOwnerBankProfileError('');
      const result = await getOwnerProfile();
      if (!cancelled) {
        if (result.error) {
          setOwnerBankProfileError(result.error);
          setOwnerBankProfile(null);
        } else {
          setOwnerBankProfile(result.profile);
          applyOwnerProfileTier(result.profile);
        }
        ownerBankProfileFetchRef.current = true;
        setOwnerBankProfileLoading(false);
      }
    };
    loadProfile();
    return () => { cancelled = true; };
  }, [activeTab, applyOwnerProfileTier]);

  const machineLookup = useMemo(() => buildMachineLookup(machineData), [machineData]);
  const groupedOwnerBookings = useMemo(() => groupOwnerBookingsSchedule(ownerBookings), [ownerBookings]);

  const reportSettlementStats = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    let totalEarned = 0;
    let thisMonth = 0;
    let pending = 0;
    for (const row of settlements) {
      const net = Number(row.net_owner_amount || 0);
      const status = String(row.status || '').toLowerCase();
      if (status === 'settled') {
        totalEarned += net;
        const created = row.created_at ? new Date(row.created_at) : null;
        if (created && !Number.isNaN(created.getTime())
          && created.getMonth() === month && created.getFullYear() === year) {
          thisMonth += net;
        }
      }
      if (status === 'pending_transfer') pending += net;
    }
    return { totalEarned, thisMonth, pending, totalBookings: settlements.length };
  }, [settlements]);

  const dashboardSettlementStats = useMemo(() => {
    let gross = 0;
    let commission = 0;
    let tdsTcs = 0;
    let net = 0;
    for (const row of settlements) {
      gross += Number(row.gross_amount || 0);
      commission += Number(row.commission_amount || 0);
      tdsTcs += Number(row.tds_amount || 0) + Number(row.gst_tcs_amount || 0);
      net += Number(row.net_owner_amount || 0);
    }
    return { gross, commission, tdsTcs, net };
  }, [settlements]);

  const recentSettlements = useMemo(
    () => (settlements || []).slice(0, 3),
    [settlements],
  );

  const sortedFleetMachines = useMemo(() => {
    const rows = analyticsData?.machines;
    if (!Array.isArray(rows)) return [];
    return [...rows].sort((a, b) => Number(b.total_revenue || 0) - Number(a.total_revenue || 0));
  }, [analyticsData]);

  const analyticsTrendSeries = useMemo(
    () => (Array.isArray(analyticsData?.monthly_trend) ? analyticsData.monthly_trend : []),
    [analyticsData],
  );

  const analyticsMaxRevenue = useMemo(
    () => Math.max(...analyticsTrendSeries.map((s) => Number(s.revenue || 0)), 1),
    [analyticsTrendSeries],
  );

  const displayFleetMachines = useMemo(
    () => sortedFleetMachines.filter(
      (row) => Number(row.total_bookings || 0) > 0 || Number(row.total_revenue || 0) > 0,
    ),
    [sortedFleetMachines],
  );

  const settlementStatusLabel = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'settled') return t('ownerSettlementSettled');
    if (s === 'pending_transfer') return t('ownerSettlementPending');
    if (s === 'failed') return t('ownerSettlementFailed');
    return status || '—';
  };

  const settlementStatusColor = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'settled') return '#4CAF50';
    if (s === 'pending_transfer') return '#FF9800';
    if (s === 'failed') return '#e94560';
    return '#8896a8';
  };

  const fmtInr = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN')}`;

  const fmtKpiAmount = (amount) => {
    const val = Number(amount || 0);
    if (val >= 1000) return `₹${(val / 1000).toFixed(0)}K`;
    return fmtInr(val);
  };

  const startOwnerBankProfileEdit = () => {
    const p = ownerBankProfile || {};
    setOwnerBankProfileForm({
      account_holder_name: p.account_holder_name || ownerDisplayName || '',
      bank_name: p.bank_name || '',
      account_number: p.account_number || '',
      ifsc: p.ifsc || '',
      pan_number: p.pan_number || '',
      gstin: p.gstin || '',
    });
    setOwnerBankProfileEditing(true);
    setOwnerBankProfileSuccess('');
  };

  const handleOwnerBankProfileSave = async () => {
    setOwnerBankProfileSaving(true);
    setOwnerBankProfileError('');
    setOwnerBankProfileSuccess('');
    const result = await updateOwnerProfile(ownerBankProfileForm);
    setOwnerBankProfileSaving(false);
    if (!result.ok) {
      setOwnerBankProfileError(result.message || t('actionFailed'));
      return;
    }
    setOwnerBankProfile(result.profile);
    applyOwnerProfileTier(result.profile);
    setOwnerBankProfileEditing(false);
    setOwnerBankProfileSuccess(result.message || t('ownerProfileSaved'));
    alert(t('ownerProfileSaved'));
  };

  const refreshOwnerBankProfile = async () => {
    const result = await getOwnerProfile();
    if (result.profile) {
      setOwnerBankProfile(result.profile);
      applyOwnerProfileTier(result.profile);
    }
    return result.profile;
  };

  const handleSetupAutoSettlement = async () => {
    setRouteSetupBusy(true);
    setRouteSetupError('');
    setRouteSetupSuccess('');
    try {
      const data = await secureFetch('/api/owner/route/create-account', { method: 'POST' });
      let profile = await refreshOwnerBankProfile();
      const accountId = data?.account_id || profile?.razorpay_linked_account_id;
      if (accountId && String(profile?.razorpay_linked_account_status || data?.status || '').toLowerCase() !== 'active') {
        try {
          await secureFetch('/api/owner/route/activate', { method: 'POST' });
          profile = await refreshOwnerBankProfile();
        } catch (activateErr) {
          // Linked account may already be pending admin review — keep create success.
          console.warn(activateErr);
        }
      }
      setRouteSetupSuccess(
        data?.already
          ? `Linked account ready${accountId ? `: ${accountId}` : ''}.`
          : `Auto-settlement linked account created${accountId ? `: ${accountId}` : ''}.`,
      );
    } catch (err) {
      setRouteSetupError(err?.message || t('actionFailed'));
    } finally {
      setRouteSetupBusy(false);
    }
  };

  const handleSettlementReceipt = async (row) => {
    if (!row?.id && !row?.booking_ref) return;
    const rowId = row.id || row.booking_ref;
    setReceiptGeneratingId(rowId);
    try {
      let apiProfile = ownerBankProfile;
      if (!apiProfile) {
        const result = await getOwnerProfile();
        apiProfile = result.profile;
        if (result.profile) setOwnerBankProfile(result.profile);
      }
      const mapped = mapOwnerProfileForReceipt(apiProfile || {}, sessionUser);
      if (isOwnerProfileIncomplete(mapped)) {
        alert(t('ownerProfileIncomplete'));
        return;
      }
      await generateOwnerReceipt(buildOwnerReceiptPayload(row, sessionUser, apiProfile || {}));
    } catch (err) {
      alert(err?.message || t('actionFailed'));
    } finally {
      setReceiptGeneratingId(null);
    }
  };

  const handleCompleteBooking = async (booking, setBookings) => {
    if (!booking?.id || completingId) return;
    setCompletingId(booking.id);
    const result = await completeBooking(booking.id);
    setCompletingId(null);
    if (!result.ok) {
      alert(result.message || t('actionFailed'));
      return;
    }
    const st = result.settlement || {};
    setBookings((prev) => prev.map((x) => (x.id === booking.id
      ? { ...x, status: 'Completed', completed_at: new Date().toISOString() }
      : x)));
    setSettlementFlash({
      gross: Number(st.gross_amount || booking.total_amount || booking.base_amount || 0),
      net: Number(st.net_owner_amount || 0),
      bookingRef: st.booking_ref || booking.booking_ref,
      pending: result.settlementPending || st.status === 'pending_transfer',
    });
    if (activeTab === 'wallet') {
      const ownerId = sessionUser.id || sessionUser.user_id;
      if (ownerId) {
        const bal = await getWalletBalance(ownerId);
        setWalletBalance(Number(bal) || 0);
      }
    }
  };

  const handleWithdrawRequest = async () => {
    const amount = Number(withdrawAmt);
    if (!Number.isFinite(amount) || amount < 1000) {
      alert(t('ownerWithdrawMin'));
      return;
    }
    setWithdrawSubmitting(true);
    try {
      await submitWithdrawRequest({ amount });
      alert(t('ownerWithdrawSubmitted'));
      setWithdrawAmt('');
      const ownerId = sessionUser.id || sessionUser.user_id;
      if (ownerId) {
        const bal = await getWalletBalance(ownerId);
        setWalletBalance(Number(bal) || 0);
      }
    } catch (e) {
      alert(e?.message || t('actionFailed'));
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const handleApproveBooking = async (booking, setBookings) => {
    if (!booking?.id || approvingId) return;
    setApprovingId(booking.id);
    setApproveErrorByBookingId((prev) => {
      const next = { ...prev };
      delete next[booking.id];
      return next;
    });
    const result = await approveBooking(booking.id);
    setApprovingId(null);
    if (!result?.ok) {
      const msg = result?.message || t('actionFailed');
      const isVerifiedGate = /verified/i.test(msg)
        || String(booking.booking_type || '').toLowerCase() === 'contract';
      if (isVerifiedGate) {
        setApproveErrorByBookingId((prev) => ({
          ...prev,
          [booking.id]: /verified/i.test(msg) ? msg : CONTRACT_VERIFIED_REQUIRED_MSG,
        }));
      } else {
        alert(msg);
      }
      return;
    }
    setBookings((prev) => prev.map((x) => (x.id === booking.id
      ? { ...x, owner_approved: true, owner_approved_at: new Date().toISOString() }
      : x)));
    alert(`${t('approved')}! ${t('dispatched')}.`);
  };

  const loadPendingQuotations = useCallback(async () => {
    setPendingQuotationsLoading(true);
    setPendingQuotationsError('');
    try {
      const [pendingData, awaitingData, confirmedData] = await Promise.all([
        listOwnerPendingQuotations(),
        listOwnerAwaitingMobilizationQuotations(),
        listOwnerMobilizationConfirmedQuotations(),
      ]);
      setPendingQuotations(Array.isArray(pendingData?.items) ? pendingData.items : []);
      setAwaitingMobQuotations(Array.isArray(awaitingData?.items) ? awaitingData.items : []);
      setConfirmedMobQuotations(Array.isArray(confirmedData?.items) ? confirmedData.items : []);
    } catch (err) {
      setPendingQuotations([]);
      setAwaitingMobQuotations([]);
      setConfirmedMobQuotations([]);
      setPendingQuotationsError(err?.message || 'Failed to load pending quotations');
    } finally {
      setPendingQuotationsLoading(false);
    }
  }, []);

  const handleConfirmMobilization = async (quotation, booking) => {
    if (!quotation?.id || mobilizationActionId) return;
    setMobilizationActionId(quotation.id);
    try {
      const result = await confirmOwnerMobilization(quotation.id);
      if (!result?.success) {
        alert(result?.message || t('actionFailed'));
        return;
      }
      const releaseAmount = Number(result.releaseAmount != null
        ? result.releaseAmount
        : Number(quotation.advanceRequired || 0) * 0.5);
      const bookingId = booking?.id || quotation.bookingId;
      if (bookingId) {
        setMobilizationReleasedByBookingId((prev) => ({
          ...prev,
          [bookingId]: releaseAmount,
        }));
      }
      setAwaitingMobQuotations((prev) => prev.filter((q) => q.id !== quotation.id));

      const autoConverted = result.quotation?.status === 'converted'
        || result.converted
        || result.alreadyConverted;
      if (autoConverted && bookingId) {
        setConvertedBookingIds((prev) => ({ ...prev, [bookingId]: true }));
        setConfirmedMobQuotations((prev) => prev.filter((q) => q.id !== quotation.id));
      } else if (result.quotation?.status === 'mobilization_confirmed') {
        setConfirmedMobQuotations((prev) => {
          const without = prev.filter((q) => q.id !== quotation.id);
          return [...without, result.quotation];
        });
      }

      const ownerId = sessionUser.id || sessionUser.user_id;
      if (ownerId) {
        const bal = await getWalletBalance(ownerId);
        setWalletBalance(Number(bal) || 0);
      }
      if (result.convertError) {
        alert('50% advance released. Convert failed — use Convert to Active Contract.');
      } else if (autoConverted) {
        alert('50% advance released. Contract active ✅');
      } else {
        alert('50% advance released. Confirm conversion when ready.');
      }
    } catch (err) {
      alert(err?.message || t('actionFailed'));
    } finally {
      setMobilizationActionId(null);
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const handleSubmitLoadingMilestone = async () => {
    const booking = loadingMilestoneModal;
    if (!booking?.id || loadingMilestoneBusyId) return;
    if (!loadingPhotoFile) {
      setLoadingMilestoneError('Loading photo is required.');
      return;
    }
    setLoadingMilestoneBusyId(booking.id);
    setLoadingMilestoneError('');
    try {
      const photoUrl = await readFileAsDataUrl(loadingPhotoFile);
      const receiptUrl = loadingReceiptFile
        ? await readFileAsDataUrl(loadingReceiptFile)
        : null;
      const result = await secureFetch(
        `/api/owner/bookings/${encodeURIComponent(booking.id)}/mobilization/submit-loading`,
        {
          method: 'POST',
          body: JSON.stringify({ photoUrl, receiptUrl }),
        },
      );
      if (!result?.success) {
        setLoadingMilestoneError(result?.message || 'Failed to submit loading milestone');
        return;
      }
      const submittedAt = result.submittedAt || new Date().toISOString();
      setOwnerBookings((prev) => prev.map((b) => (
        b.id === booking.id
          ? {
            ...b,
            mobilization_loading_photo_url: photoUrl,
            mobilization_loading_receipt_url: receiptUrl,
            mobilization_loading_submitted_at: submittedAt,
          }
          : b
      )));
      setLoadingMilestoneModal(null);
      setLoadingPhotoFile(null);
      setLoadingReceiptFile(null);
      alert('Loading submitted — awaiting admin approval');
    } catch (err) {
      setLoadingMilestoneError(err?.message || 'Failed to submit loading milestone');
    } finally {
      setLoadingMilestoneBusyId(null);
    }
  };

  const handleConvertQuotation = async (quotation, booking) => {
    if (!quotation?.id || convertActionId) return;
    setConvertActionId(quotation.id);
    try {
      const result = await convertOwnerQuotation(quotation.id);
      if (!result?.success) {
        alert(result?.message || t('actionFailed'));
        return;
      }
      const bookingId = booking?.id || quotation.bookingId;
      if (bookingId) {
        setConvertedBookingIds((prev) => ({ ...prev, [bookingId]: true }));
      }
      setConfirmedMobQuotations((prev) => prev.filter((q) => q.id !== quotation.id));
      alert('Contract active ✅');
    } catch (err) {
      alert(err?.message || t('actionFailed'));
    } finally {
      setConvertActionId(null);
    }
  };

  const handleAcceptQuotation = async (quotation) => {
    if (!quotation?.id || quotationActionId) return;
    setQuotationActionId(quotation.id);
    try {
      const result = await acceptOwnerQuotation(quotation.id);
      if (!result?.success) {
        alert(result?.message || t('actionFailed'));
        return;
      }
      setPendingQuotations((prev) => prev.filter((q) => q.id !== quotation.id));
      loadAlerts();
      alert('Quotation accepted. It is now in admin review.');
    } catch (err) {
      alert(err?.message || t('actionFailed'));
    } finally {
      setQuotationActionId(null);
    }
  };

  const handleRejectQuotation = async (quotation) => {
    if (!quotation?.id || quotationActionId) return;
    const reason = window.prompt('Optional reject reason (shown for audit):', '') || '';
    if (!window.confirm('Reject this quotation? The client will be told the machine is not available.')) {
      return;
    }
    setQuotationActionId(quotation.id);
    try {
      const result = await rejectOwnerQuotation(quotation.id, { rejectReason: reason || null });
      if (!result?.success) {
        alert(result?.message || t('actionFailed'));
        return;
      }
      setPendingQuotations((prev) => prev.filter((q) => q.id !== quotation.id));
      loadAlerts();
      alert('Quotation rejected.');
    } catch (err) {
      alert(err?.message || t('actionFailed'));
    } finally {
      setQuotationActionId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'bookings') {
      loadPendingQuotations();
    }
  }, [activeTab, loadPendingQuotations]);

  const handleRegNext = () => {
    const err = validateRegistrationStep(regStep, regData, regDocuments, t);
    if (err) {
      setRegError(err);
      return;
    }
    setRegError('');
    setRegStep((s) => s + 1);
  };

  const handleDocumentSelect = (key, file) => {
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setRegError(t('regFileTypeError'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setRegError(t('regFileSizeError'));
      return;
    }
    setRegError('');
    setRegDocuments((prev) => ({ ...prev, [key]: file }));
  };

  const resetRegistrationForm = () => {
    setRegStep(1);
    setRegData({
      ownerName: ownerDisplayName,
      ownerPhone,
      ownerEmail,
      mobilityClass: '',
      machineName: '', machineType: '', regNo: '', year: '', capacity: '',
      payment_due_days: 15,
      early_payment_days: 3,
      early_payment_discount_pct: 0,
      late_payment_fee_pct: 0,
      pdiChecked: false, insuranceValid: false, pollutionValid: false,
      agreed: false,
    });
    setRegDocuments(emptyRegDocumentsForMobility(''));
  };

  const resetOpForm = () => {
    setOpStep(1);
    setOpData({ name: '', phone: '', password: '', experienceYears: '', experienceMachineTypes: [], monthlySalary: '' });
    setOpFiles({ photo: null, license: null, aadhaarFront: null, aadhaarBack: null, police: null });
    setOpPaths({ photo: '', license: '', aadhaarFront: '', aadhaarBack: '' });
    setOpError('');
    setOpSuccess('');
    setOpSubmitting(false);
  };

  const handleOpFileUpload = (type, file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setOpError('Invalid file type — JPG/PNG/PDF only');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setOpError('File too large — max 5MB');
      return;
    }
    setOpError('');
    setOpFiles((prev) => ({ ...prev, [type]: file }));
  };

  // Star operator calculation
  function getOperatorStar(op) {
    const days = op.created_at
      ? Math.floor(
        (Date.now() - new Date(op.created_at))
        / (1000 * 60 * 60 * 24),
      )
      : 0;
    const exp = Number(op.experience_years || 0);

    if (days >= 180 && exp >= 5) {
      return { stars: '⭐⭐⭐', label: 'Star Operator', color: '#c9a84c' };
    } if (days >= 90 && exp >= 2) {
      return { stars: '⭐⭐', label: 'Experienced', color: '#e2c97e' };
    } if (days >= 30 && exp >= 1) {
      return { stars: '⭐', label: 'Rising', color: '#8896a8' };
    }
    return { stars: '', label: 'New', color: '#8896a8' };
  }

  // Days with us
  function getDaysWithUs(createdAt) {
    if (!createdAt) return 0;
    return Math.floor(
      (Date.now() - new Date(createdAt))
      / (1000 * 60 * 60 * 24),
    );
  }

  const fetchOperators = async () => {
    setOpListLoading(true);
    try {
      const data = await secureFetch('/api/owner/operators');
      if (data.success) setOperatorList(data.operators);
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      console.error(e);
    } finally {
      setOpListLoading(false);
    }
  };

  const fetchAdvanceLedger = async (operatorId) => {
    setAdvanceLedgerLoading((prev) => ({ ...prev, [operatorId]: true }));
    try {
      const data = await secureFetch(`/api/owner/operators/${operatorId}/advances`);
      if (data.success) {
        setAdvanceLedger((prev) => ({ ...prev, [operatorId]: data }));
        setOperatorList((prev) => prev.map((op) => (
          op.id === operatorId
            ? {
              ...op,
              advance_total_given: data.advance_total_given,
              advance_total_deducted: data.advance_total_deducted,
              advance_balance: data.advance_balance,
            }
            : op
        )));
      }
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      console.error(e);
    } finally {
      setAdvanceLedgerLoading((prev) => ({ ...prev, [operatorId]: false }));
    }
  };

  const handleOpenAdvancePanel = async (operatorId) => {
    if (advancePanelOperatorId === operatorId) {
      setAdvancePanelOperatorId(null);
      setAdvanceError('');
      return;
    }
    setAdvancePanelOperatorId(operatorId);
    setAdvanceForm({ amount: '', note: '' });
    setAdvanceError('');
    await fetchAdvanceLedger(operatorId);
  };

  const handleGiveAdvance = async (operatorId) => {
    const parsedAmount = Number(advanceForm.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setAdvanceError(t('validAdvanceRequired'));
      return;
    }
    setAdvanceSubmitting(true);
    setAdvanceError('');
    try {
      await secureFetch(`/api/owner/operators/${operatorId}/advances`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsedAmount,
          note: advanceForm.note.trim() || undefined,
        }),
      });
      setAdvanceForm({ amount: '', note: '' });
      await fetchAdvanceLedger(operatorId);
      await fetchOperators();
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAdvanceError(err?.message || t('failedToRecordAdvance'));
    } finally {
      setAdvanceSubmitting(false);
    }
  };

  const getPayrollMonthForOperator = (operatorId) => (
    payrollMonthByOperator[operatorId] || getCurrentPayrollMonthStr()
  );

  const fetchPayrollPreview = async (operatorId, month) => {
    const key = payrollMonthKey(operatorId, month);
    setPayrollPreviewLoading((prev) => ({ ...prev, [key]: true }));
    setPayrollPreviewError((prev) => ({ ...prev, [key]: '' }));
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/payroll/preview?month=${encodeURIComponent(month)}`,
      );
      setPayrollPreviewByKey((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setPayrollPreviewError((prev) => ({
        ...prev,
        [key]: err?.message || t('failedToLoad'),
      }));
    } finally {
      setPayrollPreviewLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const fetchPayrollHistory = async (operatorId) => {
    setPayrollHistoryLoading((prev) => ({ ...prev, [operatorId]: true }));
    setPayrollHistoryError((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/payroll/history?limit=12`,
      );
      setPayrollHistoryByOperator((prev) => ({
        ...prev,
        [operatorId]: data.history || [],
      }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setPayrollHistoryError((prev) => ({
        ...prev,
        [operatorId]: err?.message || t('failedToLoad'),
      }));
    } finally {
      setPayrollHistoryLoading((prev) => ({ ...prev, [operatorId]: false }));
    }
  };

  const handleOpenPayrollPanel = async (operatorId) => {
    if (payrollPanelOperatorId === operatorId) {
      setPayrollPanelOperatorId(null);
      setPayrollRunError((prev) => ({ ...prev, [operatorId]: '' }));
      setPayrollRunSuccess((prev) => ({ ...prev, [operatorId]: '' }));
      return;
    }
    const month = getCurrentPayrollMonthStr();
    setPayrollPanelOperatorId(operatorId);
    setPayrollMonthByOperator((prev) => ({ ...prev, [operatorId]: month }));
    setPayrollRunError((prev) => ({ ...prev, [operatorId]: '' }));
    setPayrollRunSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    await Promise.all([
      fetchPayrollPreview(operatorId, month),
      fetchPayrollHistory(operatorId),
    ]);
  };

  const handlePayrollMonthChange = async (operatorId, month) => {
    setPayrollMonthByOperator((prev) => ({ ...prev, [operatorId]: month }));
    setPayrollRunError((prev) => ({ ...prev, [operatorId]: '' }));
    setPayrollRunSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    await fetchPayrollPreview(operatorId, month);
  };

  const handleRunPayroll = async (operatorId) => {
    const month = getPayrollMonthForOperator(operatorId);
    const key = payrollMonthKey(operatorId, month);
    setPayrollRunning((prev) => ({ ...prev, [key]: true }));
    setPayrollRunError((prev) => ({ ...prev, [operatorId]: '' }));
    setPayrollRunSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/payroll/run`,
        {
          method: 'POST',
          body: JSON.stringify({ month }),
        },
      );
      setPayrollRunSuccess((prev) => ({
        ...prev,
        [operatorId]: `${t('payrollRunSuccess')} — ${t('payrollNet')}: ₹${Number(data.net_pay || 0).toLocaleString('en-IN')}, ${t('payrollAdvanceDeducted')}: ₹${Number(data.advance_deducted || 0).toLocaleString('en-IN')}`,
      }));
      setPayrollRunCompleted((prev) => ({ ...prev, [key]: true }));
      await fetchPayrollPreview(operatorId, month);
      await fetchPayrollHistory(operatorId);
      await fetchOperators();
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      if (err?.message === 'PAYROLL_ALREADY_RUN') {
        setPayrollRunError((prev) => ({ ...prev, [operatorId]: t('payrollAlreadyRun') }));
        setPayrollRunCompleted((prev) => ({ ...prev, [key]: true }));
        return;
      }
      if (err?.message === 'NO_PAYABLE_AMOUNT') {
        setPayrollRunError((prev) => ({ ...prev, [operatorId]: t('payrollNoAmount') }));
        return;
      }
      setPayrollRunError((prev) => ({
        ...prev,
        [operatorId]: err?.message || t('failedToLoad'),
      }));
    } finally {
      setPayrollRunning((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleExportPayrollCsv = async () => {
    const month = payrollExportMonth || getCurrentPayrollMonthStr();
    setPayrollExportLoading(true);
    setPayrollExportError('');
    try {
      const data = await secureFetch(
        `/api/owner/payroll/export?month=${encodeURIComponent(month)}`,
      );
      if (!data.success) {
        setPayrollExportError(data.error || t('failedToLoad'));
        return;
      }
      const exportRows = data.rows || [];
      const headers = [
        'Operator Name',
        'Phone',
        'Monthly Salary',
        'Daily Rate',
        'Present',
        'Half Day',
        'Paid Leave',
        'Gross Payable',
        'Advance Balance',
        'Net Payable',
      ];
      const csvRows = exportRows.map((row) => [
        row.operator_name,
        forceCsvText(row.phone),
        row.monthly_salary,
        row.daily_rate,
        row.present_days,
        row.half_days,
        row.paid_leave,
        row.gross_payable,
        row.advance_balance,
        row.net_payable,
      ]);
      const csv = buildCsvFromRows(headers, csvRows);
      await downloadCsvContent(csv, `DE-Payroll-${month}.csv`);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setPayrollExportError(err?.message || t('failedToLoad'));
    } finally {
      setPayrollExportLoading(false);
    }
  };

  const payrollExportParts = String(payrollExportMonth || getCurrentPayrollMonthStr()).split('-');
  const payrollExportYear = Number(payrollExportParts[0]) || new Date().getFullYear();
  const payrollExportMonthNum = Number(payrollExportParts[1]) || (new Date().getMonth() + 1);
  const payrollExportYearOptions = (() => {
    const y = new Date().getFullYear();
    return [y, y - 1, y - 2];
  })();
  const setPayrollExportParts = (year, monthNum) => {
    setPayrollExportMonth(`${year}-${String(monthNum).padStart(2, '0')}`);
    setPayrollExportError('');
  };

  const getAttendanceMonthForOperator = (operatorId) => (
    attendanceMonthByOperator[operatorId] || getCurrentPayrollMonthStr()
  );

  const fetchOperatorAttendance = async (operatorId, month) => {
    const key = payrollMonthKey(operatorId, month);
    setAttendanceLoading((prev) => ({ ...prev, [key]: true }));
    setAttendanceError((prev) => ({ ...prev, [key]: '' }));
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/attendance?month=${encodeURIComponent(month)}`,
      );
      setAttendanceByKey((prev) => ({ ...prev, [key]: data }));
      setAttendanceEditDraft((prev) => {
        const next = { ...prev };
        delete next[operatorId];
        return next;
      });
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAttendanceError((prev) => ({
        ...prev,
        [key]: err?.message || t('failedToLoad'),
      }));
    } finally {
      setAttendanceLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const fetchOperatorPlQuota = async (operatorId) => {
    const currentYear = new Date().getFullYear();
    setPlQuotaLoading((prev) => ({ ...prev, [operatorId]: true }));
    setPlQuotaError((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/pl-quota?year=${currentYear}`,
      );
      const annualPlQuota = Number(data.quota?.annual_pl_quota ?? data.annual_pl_quota ?? 12);
      const plUsed = Number(data.quota?.pl_used ?? data.pl_used ?? 0);
      const plRemaining = Number.isFinite(Number(data.quota?.pl_remaining))
        ? Number(data.quota.pl_remaining)
        : annualPlQuota - plUsed;
      setPlQuotaByOperator((prev) => ({
        ...prev,
        [operatorId]: {
          annual_pl_quota: annualPlQuota,
          pl_used: plUsed,
          pl_remaining: plRemaining,
        },
      }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setPlQuotaError((prev) => ({
        ...prev,
        [operatorId]: err?.message || t('failedToLoad'),
      }));
    } finally {
      setPlQuotaLoading((prev) => ({ ...prev, [operatorId]: false }));
    }
  };

  const handleOpenAttendancePanel = async (operatorId) => {
    if (attendancePanelOperatorId === operatorId) {
      setAttendancePanelOperatorId(null);
      setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: '' }));
      if (plQuotaEditOperatorId === operatorId) {
        setPlQuotaEditOperatorId(null);
        setPlQuotaEditAmount('');
        setPlQuotaEditError('');
      }
      return;
    }
    const month = getCurrentPayrollMonthStr();
    setAttendancePanelOperatorId(operatorId);
    setAttendanceMonthByOperator((prev) => ({ ...prev, [operatorId]: month }));
    setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    setPlQuotaUpdateSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    await Promise.all([
      fetchOperatorAttendance(operatorId, month),
      fetchOperatorPlQuota(operatorId),
    ]);
  };

  const handleAttendanceMonthChange = async (operatorId, month) => {
    setAttendanceMonthByOperator((prev) => ({ ...prev, [operatorId]: month }));
    setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    await fetchOperatorAttendance(operatorId, month);
  };

  const handleSaveAttendanceStatus = async (operatorId, dateKey) => {
    const draftStatus = attendanceEditDraft[operatorId]?.[dateKey];
    if (!draftStatus) return;

    const saveKey = `${operatorId}:${dateKey}`;
    setAttendanceSavingKey(saveKey);
    setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      await secureFetch(
        `/api/owner/operators/${operatorId}/attendance/${dateKey}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: draftStatus }),
        },
      );
      setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: t('ownerAttendanceOverrideSuccess') }));
      const month = getAttendanceMonthForOperator(operatorId);
      await fetchOperatorAttendance(operatorId, month);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAttendanceError((prev) => ({
        ...prev,
        [payrollMonthKey(operatorId, getAttendanceMonthForOperator(operatorId))]:
          err?.message || t('failedToLoad'),
      }));
    } finally {
      setAttendanceSavingKey('');
    }
  };

  const handleProposeAttendanceCorrection = async (operatorId, dateKey, fallbackTime = '') => {
    const draftTime = String(
      attendanceProposeDraft[operatorId]?.[dateKey] || fallbackTime || '',
    ).trim();
    if (!draftTime) return;

    const saveKey = `${operatorId}:${dateKey}`;
    setAttendanceProposeSavingKey(saveKey);
    setAttendanceProposeError((prev) => ({ ...prev, [saveKey]: '' }));
    setAttendanceSaveSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      await secureFetch(
        `/api/owner/operators/${operatorId}/attendance/${dateKey}/propose-correction`,
        {
          method: 'PATCH',
          body: JSON.stringify({ proposed_check_in: draftTime }),
        },
      );
      setAttendanceSaveSuccess((prev) => ({
        ...prev,
        [operatorId]: `Correction proposed for ${dateKey}`,
      }));
      const month = getAttendanceMonthForOperator(operatorId);
      await fetchOperatorAttendance(operatorId, month);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setAttendanceProposeError((prev) => ({
        ...prev,
        [saveKey]: err?.message || t('actionFailed'),
      }));
    } finally {
      setAttendanceProposeSavingKey('');
    }
  };

  const handleOpenSalaryEdit = (operatorId, currentSalary) => {
    if (salaryEditOperatorId === operatorId) {
      setSalaryEditOperatorId(null);
      setSalaryEditAmount('');
      setSalaryEditError('');
      return;
    }
    setSalaryEditOperatorId(operatorId);
    const parsed = Number(currentSalary);
    setSalaryEditAmount(Number.isFinite(parsed) && parsed > 0 ? String(Math.round(parsed)) : '');
    setSalaryEditError('');
    setSalaryUpdateSuccess((prev) => ({ ...prev, [operatorId]: '' }));
  };

  const handleCancelSalaryEdit = () => {
    setSalaryEditOperatorId(null);
    setSalaryEditAmount('');
    setSalaryEditError('');
  };

  const handleSaveOperatorSalary = async (operatorId) => {
    const parsedAmount = Number(salaryEditAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setSalaryEditError(t('monthlySalaryRequired'));
      return;
    }
    setSalaryEditSubmitting(true);
    setSalaryEditError('');
    try {
      const data = await secureFetch(
        `/api/owner/operators/${operatorId}/salary`,
        {
          method: 'PATCH',
          body: JSON.stringify({ monthly_salary: parsedAmount }),
        },
      );
      const updatedSalary = data.monthly_salary ?? parsedAmount;
      setOperatorList((prev) => prev.map((op) => (
        op.id === operatorId ? { ...op, monthly_salary: updatedSalary } : op
      )));
      setSalaryUpdateSuccess((prev) => ({ ...prev, [operatorId]: t('ownerSalaryUpdated') }));
      setSalaryEditOperatorId(null);
      setSalaryEditAmount('');
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setSalaryEditError(err?.message || t('failedToLoad'));
    } finally {
      setSalaryEditSubmitting(false);
    }
  };

  const handleOpenPlQuotaEdit = (operatorId, currentQuota) => {
    if (plQuotaEditOperatorId === operatorId) {
      setPlQuotaEditOperatorId(null);
      setPlQuotaEditAmount('');
      setPlQuotaEditError('');
      return;
    }
    setPlQuotaEditOperatorId(operatorId);
    const parsed = Number(currentQuota);
    setPlQuotaEditAmount(Number.isFinite(parsed) && parsed >= 0 ? String(Math.floor(parsed)) : '12');
    setPlQuotaEditError('');
    setPlQuotaUpdateSuccess((prev) => ({ ...prev, [operatorId]: '' }));
  };

  const handleCancelPlQuotaEdit = () => {
    setPlQuotaEditOperatorId(null);
    setPlQuotaEditAmount('');
    setPlQuotaEditError('');
  };

  const handleSavePlQuota = async (operatorId) => {
    const parsedQuota = Number(plQuotaEditAmount);
    if (!Number.isFinite(parsedQuota) || parsedQuota < 0) {
      setPlQuotaEditError(t('failedToLoad'));
      return;
    }

    setPlQuotaEditSubmitting(true);
    setPlQuotaEditError('');
    setPlQuotaUpdateSuccess((prev) => ({ ...prev, [operatorId]: '' }));
    try {
      await secureFetch(
        `/api/owner/operators/${operatorId}/pl-quota`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            annual_pl_quota: Math.floor(parsedQuota),
            year: new Date().getFullYear(),
          }),
        },
      );
      setPlQuotaUpdateSuccess((prev) => ({ ...prev, [operatorId]: t('plQuotaUpdated') }));
      setPlQuotaEditOperatorId(null);
      setPlQuotaEditAmount('');
      await fetchOperatorPlQuota(operatorId);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setPlQuotaEditError(err?.message || t('failedToLoad'));
    } finally {
      setPlQuotaEditSubmitting(false);
    }
  };

  const handleAssignMachine = async (operatorId, machineId) => {
    setAssignError('');
    try {
      const data = await secureFetch(
        `/api/owner/machines/${machineId}/assign-operator`,
        {
          method: 'PATCH',
          body: JSON.stringify({ operatorId }),
        },
      );
      if (data.success) {
        await fetchOperators();
        const machines = await getMachines();
        const ownerId = sessionUser?.id || sessionUser?.user_id;
        setMachineData(
          Array.isArray(machines)
            ? machines.filter((m) => !ownerId || m.owner_id === ownerId)
            : [],
        );
        setAssigningOperatorId(null);
      } else {
        if (data.error === 'KYC_REJECTED') {
          setAssignError(t('operatorKycRejectedAssign'));
        } else {
          setAssignError(data.error || t('assignOperatorFailed'));
        }
      }
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      if (e?.message === 'KYC_REJECTED') {
        setAssignError(t('operatorKycRejectedAssign'));
      } else {
        setAssignError(e?.message || t('assignOperatorFailed'));
      }
    }
  };

  const handleSaveMachine = async (machineId) => {
    try {
      await secureFetch(
        `/api/owner/machines/${machineId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(editMachineForm),
        },
      );
      setEditingMachineId(null);
      setEditMachineForm({});
      const machines = await getMachines();
      const ownerId = sessionUser?.id ||
        sessionUser?.user_id;
      setMachineData(
        Array.isArray(machines)
          ? machines.filter((m) =>
            !ownerId || m.owner_id === ownerId)
          : [],
      );
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      alert(t('machineUpdateFailed'));
    }
  };

  const openFinancialEdit = (machineUuid, raw) => {
    setEditingFinancialMachineId(machineUuid);
    setFinancialForm({
      ownership_type: raw?.ownership_type || 'new',
      purchase_price: raw?.purchase_price ?? '',
      purchase_date: raw?.purchase_date ? String(raw.purchase_date).slice(0, 10) : '',
      purchase_year: raw?.purchase_year ?? raw?.year ?? '',
      loan_amount: raw?.loan_amount ?? '',
      monthly_emi: raw?.monthly_emi ?? '',
      loan_tenure_months: raw?.loan_tenure_months ?? '',
      loan_start_date: raw?.loan_start_date ? String(raw.loan_start_date).slice(0, 10) : '',
      fuel_consumption_liters_per_hour: raw?.fuel_consumption_liters_per_hour ?? '',
    });
    setFinancialLoanOpen(Boolean(
      raw?.loan_amount || raw?.monthly_emi || raw?.loan_tenure_months || raw?.loan_start_date,
    ));
  };

  const handleSaveFinancialDetails = async (machineId) => {
    setFinancialSaving(true);
    try {
      const toNumOrNull = (val) => {
        if (val === '' || val == null) return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
      };
      const body = {
        ownership_type: financialForm.ownership_type || null,
        purchase_price: toNumOrNull(financialForm.purchase_price),
        purchase_date: financialForm.purchase_date || null,
        purchase_year: toNumOrNull(financialForm.purchase_year),
        fuel_consumption_liters_per_hour: toNumOrNull(financialForm.fuel_consumption_liters_per_hour),
      };
      if (financialLoanOpen) {
        body.loan_amount = toNumOrNull(financialForm.loan_amount);
        body.monthly_emi = toNumOrNull(financialForm.monthly_emi);
        body.loan_tenure_months = toNumOrNull(financialForm.loan_tenure_months);
        body.loan_start_date = financialForm.loan_start_date || null;
      } else {
        body.loan_amount = null;
        body.monthly_emi = null;
        body.loan_tenure_months = null;
        body.loan_start_date = null;
      }
      await secureFetch(
        `/api/owner/machines/${machineId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      setEditingFinancialMachineId(null);
      setFinancialForm({});
      setFinancialLoanOpen(false);
      const machines = await getMachines();
      const ownerId = sessionUser?.id || sessionUser?.user_id;
      setMachineData(
        Array.isArray(machines)
          ? machines.filter((m) => !ownerId || m.owner_id === ownerId)
          : [],
      );
      await loadRecoveryForMachine(machineId);
      alert(t('financialDetailsSaved'));
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      alert(e?.message || t('machineUpdateFailed'));
    } finally {
      setFinancialSaving(false);
    }
  };

  const renderFinancialEditForm = (machineUuid) => (
    <div style={{ marginTop: 8 }}>
      <p style={{
        color: '#8896a8',
        fontSize: 11,
        margin: '0 0 6px',
        fontWeight: 600,
      }}>
        {t('machineOwnershipType')}
      </p>
      <div style={{ marginBottom: 8 }}>
        {FINANCIAL_OWNERSHIP_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: '#e8e0d0',
              fontSize: 11,
              marginBottom: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name={`ownership-${machineUuid}`}
              value={opt.value}
              checked={financialForm.ownership_type === opt.value}
              onChange={() => setFinancialForm((prev) => ({
                ...prev,
                ownership_type: opt.value,
              }))}
            />
            {t(opt.labelKey)}
          </label>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{
          color: '#8896a8',
          fontSize: 11,
          display: 'block',
          marginBottom: 3,
        }}>
          {t('machinePurchasePrice')}
        </label>
        <input
          type="number"
          min="0"
          className="de-owner-input"
          value={financialForm.purchase_price ?? ''}
          onChange={(e) => setFinancialForm((prev) => ({
            ...prev,
            purchase_price: e.target.value,
          }))}
        />
      </div>
      {(financialForm.ownership_type === 'new'
        || financialForm.ownership_type === 'used_first_owner') && (
        <div style={{ marginBottom: 8 }}>
          <label style={{
            color: '#8896a8',
            fontSize: 11,
            display: 'block',
            marginBottom: 3,
          }}>
            {t('machinePurchaseDate')}
          </label>
          <input
            type="date"
            className="de-owner-input"
            value={financialForm.purchase_date || ''}
            onChange={(e) => setFinancialForm((prev) => ({
              ...prev,
              purchase_date: e.target.value,
            }))}
          />
        </div>
      )}
      <div style={{ marginBottom: 8 }}>
        <label style={{
          color: '#8896a8',
          fontSize: 11,
          display: 'block',
          marginBottom: 3,
        }}>
          {t('machineYearOfManufacture')}
        </label>
        <input
          type="number"
          min="1950"
          max="2100"
          className="de-owner-input"
          value={financialForm.purchase_year ?? ''}
          onChange={(e) => setFinancialForm((prev) => ({
            ...prev,
            purchase_year: e.target.value,
          }))}
        />
      </div>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: '#e8e0d0',
        fontSize: 11,
        marginBottom: 8,
        cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={financialLoanOpen}
          onChange={(e) => {
            setFinancialLoanOpen(e.target.checked);
            if (!e.target.checked) {
              setFinancialForm((prev) => ({
                ...prev,
                loan_amount: '',
                monthly_emi: '',
                loan_tenure_months: '',
                loan_start_date: '',
              }));
            }
          }}
        />
        {t('machineLoanSection')}
      </label>
      {financialLoanOpen && (
        <div style={{ marginBottom: 8 }}>
          {[
            { key: 'loan_amount', labelKey: 'machineLoanAmount' },
            { key: 'monthly_emi', labelKey: 'machineLoanEmi' },
            { key: 'loan_tenure_months', labelKey: 'machineLoanTenure' },
          ].map((field) => (
            <div key={field.key} style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t(field.labelKey)}
              </label>
              <input
                type="number"
                min="0"
                className="de-owner-input"
                value={financialForm[field.key] ?? ''}
                onChange={(e) => setFinancialForm((prev) => ({
                  ...prev,
                  [field.key]: e.target.value,
                }))}
              />
            </div>
          ))}
          <div style={{ marginBottom: 8 }}>
            <label style={{
              color: '#8896a8',
              fontSize: 11,
              display: 'block',
              marginBottom: 3,
            }}>
              {t('machineLoanStartDate')}
            </label>
            <input
              type="date"
              className="de-owner-input"
              value={financialForm.loan_start_date || ''}
              onChange={(e) => setFinancialForm((prev) => ({
                ...prev,
                loan_start_date: e.target.value,
              }))}
            />
          </div>
        </div>
      )}
      <div style={{ marginBottom: 8 }}>
        <label style={{
          color: '#8896a8',
          fontSize: 11,
          display: 'block',
          marginBottom: 3,
        }}>
          {t('machineFuelConsumption')}
        </label>
        <input
          type="number"
          min="0"
          step="0.1"
          className="de-owner-input"
          value={financialForm.fuel_consumption_liters_per_hour ?? ''}
          onChange={(e) => setFinancialForm((prev) => ({
            ...prev,
            fuel_consumption_liters_per_hour: e.target.value,
          }))}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          disabled={financialSaving}
          onClick={() => handleSaveFinancialDetails(machineUuid)}
          style={{
            background: 'rgba(201,168,76,0.2)',
            border: '1px solid rgba(201,168,76,0.4)',
            color: '#C9A84C',
            borderRadius: 6,
            padding: '6px 16px',
            fontSize: 12,
            cursor: financialSaving ? 'wait' : 'pointer',
            fontWeight: 600,
          }}
        >
          {financialSaving ? t('loading') : t('save')}
        </button>
        <button
          type="button"
          disabled={financialSaving}
          onClick={() => {
            setEditingFinancialMachineId(null);
            setFinancialForm({});
            setFinancialLoanOpen(false);
          }}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#8896a8',
            borderRadius: 6,
            padding: '6px 16px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );

  const renderDieselSection = (machineUuid, raw) => {
    const latest = dieselLatest[machineUuid];
    const loading = dieselLoading[machineUuid];
    const pricePerLitre = latest?.price_per_litre != null
      ? Number(latest.price_per_litre)
      : null;
    const consumption = Number(raw?.fuel_consumption_liters_per_hour);
    const hourlyRate = Number(raw?.rate_per_hour);
    let fuelCostPerHour = null;
    let fuelPercentOfRate = null;
    if (pricePerLitre != null && Number.isFinite(pricePerLitre) && pricePerLitre > 0
      && Number.isFinite(consumption) && consumption > 0) {
      fuelCostPerHour = Math.round(consumption * pricePerLitre * 100) / 100;
      if (Number.isFinite(hourlyRate) && hourlyRate > 0) {
        fuelPercentOfRate = Math.round((fuelCostPerHour / hourlyRate) * 10000) / 100;
      }
    }

    return (
      <div style={{
        marginTop: 12,
        padding: 12,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 8,
        border: '1px solid rgba(255,152,0,0.2)',
      }}>
        <p style={{
          color: '#FF9800',
          fontWeight: 700,
          fontSize: 12,
          margin: '0 0 8px',
        }}>
          ⛽ {t('dieselPriceTitle')}
        </p>
        {loading ? (
          <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px' }}>{t('loading')}</p>
        ) : pricePerLitre != null && Number.isFinite(pricePerLitre) ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{ color: '#e8e0d0', fontSize: 12, fontWeight: 600, margin: '0 0 2px' }}>
              {`${t('dieselPriceLatest')}: ₹${pricePerLitre}/litre`}
            </p>
            {latest?.date && (
              <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                {latest.date}
              </p>
            )}
          </div>
        ) : (
          <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px' }}>
            {t('dieselPriceNoRecord')}
          </p>
        )}
        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => toggleDieselHistory(machineUuid)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FF9800',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
              fontWeight: 600,
              textDecoration: 'underline',
            }}
          >
            {dieselHistoryOpen[machineUuid] ? '▼' : '▶'} {t('dieselHistory')}
          </button>
          {dieselHistoryOpen[machineUuid] && (
            <div style={{ marginTop: 8 }}>
              {dieselHistoryLoading[machineUuid] ? (
                <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>{t('loading')}</p>
              ) : (dieselPriceHistory[machineUuid] || []).length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>{t('dieselNoHistory')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 10,
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,152,0,0.2)' }}>
                        <th style={{ color: '#8896a8', textAlign: 'left', padding: '4px 6px 4px 0', fontWeight: 600 }}>
                          {t('dieselColDate')}
                        </th>
                        <th style={{ color: '#8896a8', textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>
                          {t('dieselColPrice')}
                        </th>
                        <th style={{ color: '#8896a8', textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>
                          {t('dieselColQty')}
                        </th>
                        <th style={{ color: '#8896a8', textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>
                          {t('dieselTaluka')}
                        </th>
                        <th style={{ color: '#8896a8', textAlign: 'left', padding: '4px 0 4px 6px', fontWeight: 600 }}>
                          {t('dieselColSource')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dieselPriceHistory[machineUuid] || []).map((row) => (
                        <tr key={row.id || `${row.date}-${row.price_per_litre}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ color: '#e8e0d0', padding: '4px 6px 4px 0' }}>{row.date || '—'}</td>
                          <td style={{ color: '#e8e0d0', padding: '4px 6px' }}>
                            {row.price_per_litre != null ? `₹${row.price_per_litre}` : '—'}
                          </td>
                          <td style={{ color: '#e8e0d0', padding: '4px 6px' }}>
                            {row.quantity_litres != null ? row.quantity_litres : '—'}
                          </td>
                          <td style={{ color: '#e8e0d0', padding: '4px 6px' }}>{row.city || '—'}</td>
                          <td style={{ color: '#e8e0d0', padding: '4px 0 4px 6px' }}>{row.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        {fuelCostPerHour != null && (
          <div style={{ marginBottom: 8 }}>
            <p style={{ color: '#e8e0d0', fontSize: 12, fontWeight: 600, margin: '0 0 2px' }}>
              {`${t('dieselFuelCostPerHour')}: ₹${fuelCostPerHour}/hr`}
            </p>
            {fuelPercentOfRate != null && (
              <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                {`${fuelPercentOfRate}% ${t('dieselPercentOfRate')}`}
              </p>
            )}
          </div>
        )}
        {(() => {
          const suggestion = dieselRateSuggestion[machineUuid];
          const suggestionLoading = dieselRateSuggestionLoading[machineUuid];
          if (suggestionLoading || !suggestion?.suggestion_available
            || suggestion.direction === 'no_change') {
            return null;
          }
          const absChange = Math.abs(Number(suggestion.diesel_change) || 0);
          const absSuggested = Math.abs(Number(suggestion.suggested_change) || 0);
          const isIncrease = suggestion.direction === 'increase';
          return (
            <div style={{
              marginBottom: 8,
              padding: 10,
              borderRadius: 6,
              background: isIncrease ? 'rgba(233,69,96,0.08)' : 'rgba(76,175,80,0.08)',
              border: `1px solid ${isIncrease ? 'rgba(233,69,96,0.25)' : 'rgba(76,175,80,0.25)'}`,
            }}>
              <p style={{
                color: '#8896a8',
                fontSize: 10,
                fontWeight: 600,
                margin: '0 0 4px',
                textTransform: 'uppercase',
              }}>
                {t('dieselRateSuggestion')}
              </p>
              <p style={{
                color: isIncrease ? '#e94560' : '#4CAF50',
                fontSize: 11,
                fontWeight: 600,
                margin: '0 0 4px',
              }}>
                {isIncrease
                  ? `🔴 ${t('dieselRateIncrease')} ₹${absChange} — ₹${absSuggested}/hr`
                  : `🟢 ${t('dieselRateDecrease')} ₹${absChange} — ₹${absSuggested}/hr`}
              </p>
              <p style={{ color: '#e8e0d0', fontSize: 11, margin: '0 0 8px' }}>
                {`${t('dieselSuggestedRate')}: ₹${suggestion.suggested_rate}/hr`}
              </p>
              <button
                type="button"
                disabled={dieselRateApplying[machineUuid]}
                onClick={() => handleApplyRateSuggestion(machineUuid, suggestion.suggested_rate)}
                style={{
                  background: isIncrease ? 'rgba(233,69,96,0.2)' : 'rgba(76,175,80,0.2)',
                  border: `1px solid ${isIncrease ? 'rgba(233,69,96,0.4)' : 'rgba(76,175,80,0.4)'}`,
                  color: isIncrease ? '#e94560' : '#4CAF50',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 11,
                  cursor: dieselRateApplying[machineUuid] ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {dieselRateApplying[machineUuid]
                  ? t('loading')
                  : t('applyRateSuggestion').replace('{{rate}}', suggestion.suggested_rate)}
              </button>
            </div>
          );
        })()}
        {dieselFormOpen === machineUuid ? (
          <div style={{ marginTop: 8 }}>
            <div style={{
              marginBottom: 8,
              paddingBottom: 8,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              <p style={{
                color: '#8896a8',
                fontSize: 11,
                fontWeight: 600,
                margin: '0 0 6px',
              }}>
                {t('dieselUploadReceipt')}
              </p>
              <input
                ref={dieselReceiptInputRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleDieselReceiptUpload(machineUuid, file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={dieselReceiptUploading || dieselSaving}
                onClick={() => dieselReceiptInputRef.current?.click()}
                style={{
                  background: 'rgba(255,152,0,0.1)',
                  border: '1px solid rgba(255,152,0,0.3)',
                  color: '#FF9800',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 11,
                  cursor: dieselReceiptUploading ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {dieselReceiptUploading ? t('loading') : t('dieselUploadReceipt')}
              </button>
              {dieselExtractMessage?.machineUuid === machineUuid
                && dieselExtractMessage.type === 'success'
                && dieselExtractMessage.extracted && (
                <p style={{ color: '#4CAF50', fontSize: 11, margin: '6px 0 0', fontWeight: 600 }}>
                  {`${t('dieselExtractSuccess')}: ₹${dieselExtractMessage.extracted.price_per_litre}/litre`}
                  {dieselExtractMessage.extracted.quantity_litres != null
                    ? `, ${dieselExtractMessage.extracted.quantity_litres}L`
                    : ''}
                  {dieselExtractMessage.extracted.date
                    ? ` ${t('date')} ${dieselExtractMessage.extracted.date}`
                    : ''}
                </p>
              )}
              {dieselExtractMessage?.machineUuid === machineUuid
                && dieselExtractMessage.type === 'error' && (
                <p style={{ color: '#e94560', fontSize: 11, margin: '6px 0 0' }}>
                  {t('dieselExtractFailed')}
                </p>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('date')}
              </label>
              <input
                type="date"
                className="de-owner-input"
                value={dieselForm.date || ''}
                onChange={(e) => setDieselForm((prev) => ({
                  ...prev,
                  date: e.target.value,
                }))}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('dieselPricePerLitre')}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="de-owner-input"
                value={dieselForm.price_per_litre ?? ''}
                onChange={(e) => setDieselForm((prev) => ({
                  ...prev,
                  price_per_litre: e.target.value,
                }))}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('dieselQuantity')}
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="de-owner-input"
                value={dieselForm.quantity_litres ?? ''}
                onChange={(e) => setDieselForm((prev) => ({
                  ...prev,
                  quantity_litres: e.target.value,
                }))}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('dieselTaluka')}
              </label>
              <input
                type="text"
                className="de-owner-input"
                value={dieselForm.city ?? ''}
                onChange={(e) => setDieselForm((prev) => ({
                  ...prev,
                  city: e.target.value,
                }))}
              />
            </div>
            <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 8px' }}>
              Manual entry
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={dieselSaving || dieselReceiptUploading
                  || (dieselExtractMessage?.machineUuid === machineUuid
                    && dieselExtractMessage.type === 'success')}
                onClick={() => handleSaveDieselPrice(machineUuid)}
                style={{
                  background: 'rgba(255,152,0,0.2)',
                  border: '1px solid rgba(255,152,0,0.4)',
                  color: '#FF9800',
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 12,
                  cursor: dieselSaving ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {dieselSaving ? t('loading') : t('save')}
              </button>
              <button
                type="button"
                disabled={dieselSaving}
                onClick={() => {
                  setDieselFormOpen(null);
                  setDieselForm({});
                  setDieselExtractMessage(null);
                }}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#8896a8',
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openDieselForm(machineUuid)}
            style={{
              background: 'rgba(255,152,0,0.1)',
              border: '1px solid rgba(255,152,0,0.3)',
              color: '#FF9800',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {t('dieselPriceUpdate')}
          </button>
        )}
      </div>
    );
  };

  const renderMarketSection = (machineUuid, raw) => {
    const loading = marketPositionLoading[machineUuid];
    const data = marketPosition[machineUuid];
    const marketAvailable = data?.market_available === true;
    const position = data?.position;
    const formOpen = marketFormOpen === machineUuid;
    const machineType = raw?.type ? String(raw.type).trim() : '';

    let positionLabel = '';
    let positionColor = '#8896a8';
    if (position === 'below') {
      positionLabel = `🔴 ${t('marketBelowMarket')}`;
      positionColor = '#e94560';
    } else if (position === 'above') {
      positionLabel = `🟢 ${t('marketAboveMarket')}`;
      positionColor = '#4CAF50';
    } else if (position === 'competitive') {
      positionLabel = `🟡 ${t('marketCompetitive')}`;
      positionColor = '#FF9800';
    }

    return (
      <div style={{
        marginTop: 12,
        padding: 12,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 8,
        border: '1px solid rgba(100,149,237,0.25)',
      }}>
        <p style={{
          color: '#6495ED',
          fontWeight: 700,
          fontSize: 12,
          margin: '0 0 8px',
        }}>
          📊 {t('marketPosition')}
        </p>
        {loading ? (
          <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px' }}>{t('loading')}</p>
        ) : marketAvailable ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{
              color: positionColor,
              fontSize: 12,
              fontWeight: 700,
              margin: '0 0 6px',
            }}>
              {positionLabel}
            </p>
            <p style={{ color: '#e8e0d0', fontSize: 11, margin: '0 0 4px' }}>
              {`${t('marketRange').replace('{{city}}', data.city || '—')}: ₹${data.market_min} – ₹${data.market_max}/hr`}
            </p>
            {data.city_source === 'local' ? (
              <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 4px' }}>
                {`📍 ${t('marketSourceLocal').replace('{{city}}', data.city || '—')}`}
              </p>
            ) : data.city_source === 'platform_wide' ? (
              <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 4px' }}>
                {`🌐 ${t('marketSourcePlatform')}`}
              </p>
            ) : null}
            <p style={{ color: '#e8e0d0', fontSize: 11, margin: '0 0 4px' }}>
              {`${t('ratePerHourLabel')}: ₹${data.current_rate}/hr`}
            </p>
            <p style={{ color: '#8896a8', fontSize: 10, margin: 0 }}>
              {t('marketDataPoints').replace('{{count}}', String(data.data_points || 0))}
            </p>
          </div>
        ) : (
          <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px' }}>
            {t('marketNoData')}
          </p>
        )}
        {marketRatePendingReview[machineUuid] ? (
          <p style={{
            color: '#FF9800',
            fontSize: 11,
            fontWeight: 600,
            margin: '0 0 8px',
            padding: '8px 10px',
            background: 'rgba(255,152,0,0.12)',
            border: '1px solid rgba(255,152,0,0.35)',
            borderRadius: 6,
          }}>
            {t('marketRatePendingReview')}
          </p>
        ) : null}
        {formOpen ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('marketCity')}
              </label>
              <input
                type="text"
                className="de-owner-input"
                value={marketForm.city ?? ''}
                onChange={(e) => setMarketForm((prev) => ({
                  ...prev,
                  city: e.target.value,
                }))}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('type')}
              </label>
              <input
                type="text"
                className="de-owner-input"
                value={machineType}
                readOnly
                style={{ opacity: 0.85 }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('marketMinRate')}
              </label>
              <input
                type="number"
                min="0"
                step="50"
                className="de-owner-input"
                value={marketForm.min_rate_per_hour ?? ''}
                onChange={(e) => setMarketForm((prev) => ({
                  ...prev,
                  min_rate_per_hour: e.target.value,
                }))}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{
                color: '#8896a8',
                fontSize: 11,
                display: 'block',
                marginBottom: 3,
              }}>
                {t('marketMaxRate')}
              </label>
              <input
                type="number"
                min="0"
                step="50"
                className="de-owner-input"
                value={marketForm.max_rate_per_hour ?? ''}
                onChange={(e) => setMarketForm((prev) => ({
                  ...prev,
                  max_rate_per_hour: e.target.value,
                }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={marketSaving || !machineType}
                onClick={() => handleSubmitMarketRate(machineUuid, raw)}
                style={{
                  background: 'rgba(100,149,237,0.2)',
                  border: '1px solid rgba(100,149,237,0.4)',
                  color: '#6495ED',
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 12,
                  cursor: marketSaving ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {marketSaving ? t('loading') : t('save')}
              </button>
              <button
                type="button"
                disabled={marketSaving}
                onClick={() => {
                  setMarketFormOpen(null);
                  setMarketForm({});
                }}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#8896a8',
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openMarketForm(machineUuid, raw)}
            style={{
              background: 'rgba(100,149,237,0.1)',
              border: '1px solid rgba(100,149,237,0.3)',
              color: '#6495ED',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {t('marketSubmitRate')}
          </button>
        )}
      </div>
    );
  };

  const loadComplianceForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    try {
      const data = await secureFetch(`/api/owner/machines/${machineId}/compliance`);
      const row = data.compliance
        ? {
          insurance_start: data.compliance.insurance_start,
          insurance_expiry: data.compliance.insurance_expiry,
          rc_start: data.compliance.rc_start,
          rc_expiry: data.compliance.rc_expiry,
          puc_start: data.compliance.puc_start,
          puc_expiry: data.compliance.puc_expiry,
        }
        : {
          insurance_start: null,
          insurance_expiry: null,
          rc_start: null,
          rc_expiry: null,
          puc_start: null,
          puc_expiry: null,
        };
      setComplianceData((prev) => ({ ...prev, [machineId]: row }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      /* ignore */
    }
  }, []);

  const loadRecoveryForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    setRecoveryLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(`/api/owner/machines/${machineId}/recovery`);
      setRecoveryData((prev) => ({ ...prev, [machineId]: data }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      /* ignore */
    } finally {
      setRecoveryLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  const loadDieselLatestForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    setDieselLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(
        `/api/owner/diesel-prices/latest?machine_id=${encodeURIComponent(machineId)}`,
      );
      setDieselLatest((prev) => ({ ...prev, [machineId]: data.latest ?? null }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      /* ignore */
    } finally {
      setDieselLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  const loadDieselHistoryForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    setDieselHistoryLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(
        `/api/owner/diesel-prices?machine_id=${encodeURIComponent(machineId)}&limit=10`,
      );
      setDieselPriceHistory((prev) => ({ ...prev, [machineId]: data.prices ?? [] }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setDieselPriceHistory((prev) => ({ ...prev, [machineId]: [] }));
    } finally {
      setDieselHistoryLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  const toggleDieselHistory = async (machineUuid) => {
    if (dieselHistoryOpen[machineUuid]) {
      setDieselHistoryOpen((prev) => ({ ...prev, [machineUuid]: false }));
      return;
    }
    setDieselHistoryOpen((prev) => ({ ...prev, [machineUuid]: true }));
    await loadDieselHistoryForMachine(machineUuid);
  };

  const loadRateSuggestionForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    setDieselRateSuggestionLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(
        `/api/owner/machines/${machineId}/rate-suggestion`,
      );
      setDieselRateSuggestion((prev) => ({ ...prev, [machineId]: data }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setDieselRateSuggestion((prev) => ({ ...prev, [machineId]: { suggestion_available: false } }));
    } finally {
      setDieselRateSuggestionLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  const handleApplyRateSuggestion = async (machineUuid, suggestedRate) => {
    const rate = Number(suggestedRate);
    if (!machineUuid || !Number.isFinite(rate) || rate <= 0) return;
    setDieselRateApplying((prev) => ({ ...prev, [machineUuid]: true }));
    try {
      await secureFetch(
        `/api/owner/machines/${machineUuid}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ rate_per_hour: rate }),
        },
      );
      alert(t('rateSuggestionApplied'));
      const machines = await getMachines();
      const ownerId = sessionUser?.id || sessionUser?.user_id;
      setMachineData(
        Array.isArray(machines)
          ? machines.filter((m) => !ownerId || m.owner_id === ownerId)
          : [],
      );
      await loadRateSuggestionForMachine(machineUuid);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      alert(err?.message || t('genericError'));
    } finally {
      setDieselRateApplying((prev) => ({ ...prev, [machineUuid]: false }));
    }
  };

  const openDieselForm = (machineUuid) => {
    setDieselFormOpen(machineUuid);
    setDieselExtractMessage(null);
    setDieselForm({
      date: new Date().toISOString().slice(0, 10),
      price_per_litre: '',
      quantity_litres: '',
      city: '',
    });
  };

  const handleDieselReceiptUpload = async (machineUuid, file) => {
    if (!file || !machineUuid) return;
    setDieselReceiptUploading(true);
    setDieselExtractMessage(null);
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      formData.append('machine_id', machineUuid);
      if (dieselForm.date) {
        formData.append('date', dieselForm.date);
      }
      const data = await secureFetch('/api/owner/diesel-prices/upload-receipt', {
        method: 'POST',
        body: formData,
      });
      const extracted = data.extracted || {};
      setDieselForm((prev) => ({
        ...prev,
        date: extracted.date || prev.date,
        price_per_litre: extracted.price_per_litre ?? prev.price_per_litre ?? '',
        quantity_litres: extracted.quantity_litres ?? prev.quantity_litres ?? '',
        city: extracted.location || prev.city || '',
      }));
      setDieselExtractMessage({
        machineUuid,
        type: 'success',
        extracted,
      });
      await loadDieselLatestForMachine(machineUuid);
      await loadRateSuggestionForMachine(machineUuid);
      if (dieselHistoryOpen[machineUuid]) {
        await loadDieselHistoryForMachine(machineUuid);
      }
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setDieselExtractMessage({ machineUuid, type: 'error' });
    } finally {
      setDieselReceiptUploading(false);
    }
  };

  const handleSaveDieselPrice = async (machineUuid) => {
    setDieselSaving(true);
    try {
      const pricePerLitre = Number(dieselForm.price_per_litre);
      if (!Number.isFinite(pricePerLitre) || pricePerLitre <= 0) {
        alert(t('dieselPricePerLitre'));
        return;
      }
      if (!dieselForm.date) {
        alert(t('date'));
        return;
      }
      const body = {
        price_per_litre: pricePerLitre,
        date: dieselForm.date,
        machine_id: machineUuid,
        source: 'manual',
      };
      if (dieselForm.quantity_litres !== '' && dieselForm.quantity_litres != null) {
        body.quantity_litres = Number(dieselForm.quantity_litres);
      }
      if (dieselForm.city != null && String(dieselForm.city).trim()) {
        body.city = String(dieselForm.city).trim();
      }
      await secureFetch('/api/owner/diesel-prices', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await loadDieselLatestForMachine(machineUuid);
      await loadRateSuggestionForMachine(machineUuid);
      await loadMarketPositionForMachine(machineUuid);
      if (dieselHistoryOpen[machineUuid]) {
        await loadDieselHistoryForMachine(machineUuid);
      }
      setDieselFormOpen(null);
      setDieselForm({});
      alert(t('dieselPriceSaved'));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      alert(err?.message || t('genericError'));
    } finally {
      setDieselSaving(false);
    }
  };

  const loadMarketPositionForMachine = useCallback(async (machineId) => {
    if (!machineId) return;
    setMarketPositionLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(
        `/api/owner/machines/${machineId}/market-position`,
      );
      setMarketPosition((prev) => ({ ...prev, [machineId]: data }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setMarketPosition((prev) => ({ ...prev, [machineId]: { market_available: false } }));
    } finally {
      setMarketPositionLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  const openMarketForm = (machineUuid, raw) => {
    const city = marketPosition[machineUuid]?.city
      || dieselLatest[machineUuid]?.city
      || '';
    setMarketFormOpen(machineUuid);
    setMarketForm({
      city: city ? String(city).trim() : '',
      min_rate_per_hour: '',
      max_rate_per_hour: '',
    });
  };

  const handleSubmitMarketRate = async (machineUuid, raw) => {
    const machineType = raw?.type ? String(raw.type).trim() : '';
    if (!machineType) {
      alert(t('genericError'));
      return;
    }
    const city = marketForm.city != null ? String(marketForm.city).trim() : '';
    if (!city) {
      alert(t('marketCity'));
      return;
    }
    const minRate = Number(marketForm.min_rate_per_hour);
    const maxRate = Number(marketForm.max_rate_per_hour);
    if (!Number.isFinite(minRate) || minRate <= 0) {
      alert(t('marketMinRate'));
      return;
    }
    if (!Number.isFinite(maxRate) || maxRate <= 0) {
      alert(t('marketMaxRate'));
      return;
    }
    if (maxRate <= minRate) {
      alert(t('marketMaxRate'));
      return;
    }
    setMarketSaving(true);
    try {
      await secureFetch('/api/owner/market-rates', {
        method: 'POST',
        body: JSON.stringify({
          machine_type: machineType,
          city,
          min_rate_per_hour: minRate,
          max_rate_per_hour: maxRate,
        }),
      });
      setMarketFormOpen(null);
      setMarketForm({});
      setMarketRatePendingReview((prev) => ({ ...prev, [machineUuid]: true }));
      await loadMarketPositionForMachine(machineUuid);
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      alert(err?.message || t('genericError'));
    } finally {
      setMarketSaving(false);
    }
  };

  const handleSaveCompliance = async (machineUuid, rtoApplicable) => {
    setComplianceSaving(true);
    try {
      const body = {
        insurance_start: complianceForm.insurance_start || null,
        insurance_expiry: complianceForm.insurance_expiry || null,
      };
      if (rtoApplicable) {
        body.rc_start = complianceForm.rc_start || null;
        body.rc_expiry = complianceForm.rc_expiry || null;
        body.puc_start = complianceForm.puc_start || null;
        body.puc_expiry = complianceForm.puc_expiry || null;
      }
      await secureFetch(
        `/api/owner/machines/${machineUuid}/compliance`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      await loadComplianceForMachine(machineUuid);
      setEditingComplianceId(null);
      setComplianceForm({});
      setComplianceExtracting({});
      setComplianceExtractMessage({});
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      alert(err?.message || t('machineUpdateFailed'));
    } finally {
      setComplianceSaving(false);
    }
  };

  const handleComplianceExtract = async (machineUuid, field, file) => {
    if (!file) return;
    const fieldKey = field.endKey;
    setComplianceExtracting((prev) => ({ ...prev, [fieldKey]: true }));
    setComplianceExtractMessage((prev) => ({ ...prev, [fieldKey]: '' }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', field.docType);
      const data = await secureFetch(
        `/api/owner/machines/${machineUuid}/compliance/extract`,
        {
          method: 'POST',
          body: formData,
        },
      );
      setComplianceForm((prev) => ({
        ...prev,
        [field.startKey]: data.start_date || '',
        [field.endKey]: data.end_date || '',
      }));
      setComplianceExtractMessage((prev) => ({ ...prev, [fieldKey]: 'success' }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setComplianceExtractMessage((prev) => ({ ...prev, [fieldKey]: 'error' }));
    } finally {
      setComplianceExtracting((prev) => ({ ...prev, [fieldKey]: false }));
    }
  };

  useEffect(() => {
    if (!machineData.length) {
      setComplianceData({});
      return;
    }
    const ids = machineData.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => loadComplianceForMachine(id)));
  }, [machineData, loadComplianceForMachine]);

  useEffect(() => {
    if (activeTab !== 'machines' && activeTab !== 'edit-registration') return;
    if (!machineData.length) {
      setRecoveryData({});
      return;
    }
    const ids = machineData.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => loadRecoveryForMachine(id)));
  }, [activeTab, machineData, loadRecoveryForMachine]);

  useEffect(() => {
    if (activeTab !== 'machines' && activeTab !== 'edit-registration') return;
    if (!machineData.length) {
      setDieselLatest({});
      setDieselRateSuggestion({});
      return;
    }
    const ids = machineData.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(ids.flatMap((id) => [
      loadDieselLatestForMachine(id),
      loadRateSuggestionForMachine(id),
    ]));
  }, [activeTab, machineData, loadDieselLatestForMachine, loadRateSuggestionForMachine]);

  useEffect(() => {
    if (activeTab !== 'machines' && activeTab !== 'edit-registration') return;
    if (!machineData.length) {
      setMarketPosition({});
      return;
    }
    const ids = machineData.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => loadMarketPositionForMachine(id)));
  }, [activeTab, machineData, loadMarketPositionForMachine]);

  const loadServiceLogs = useCallback(async (machineId) => {
    if (!machineId) return;
    setServiceLoading((prev) => ({ ...prev, [machineId]: true }));
    try {
      const data = await secureFetch(`/api/owner/machines/${machineId}/service-logs`);
      setServiceLogs((prev) => ({ ...prev, [machineId]: data.logs || [] }));
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      /* ignore */
    } finally {
      setServiceLoading((prev) => ({ ...prev, [machineId]: false }));
    }
  }, []);

  useEffect(() => {
    if (!machineData.length) {
      setServiceLogs({});
      return;
    }
    const ids = machineData.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => loadServiceLogs(id)));
  }, [machineData, loadServiceLogs]);

  const handleAddServiceLog = async (machineUuid) => {
    setServiceSaving(true);
    try {
      const body = {};
      Object.entries(serviceFormData).forEach(([key, value]) => {
        if (value === '' || value == null) return;
        if (key === 'hmr_at_service' || key === 'next_service_hmr') {
          const n = Number(value);
          if (Number.isFinite(n)) body[key] = n;
          return;
        }
        body[key] = value;
      });
      await secureFetch(
        `/api/owner/machines/${machineUuid}/service-logs`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      await loadServiceLogs(machineUuid);
      setServiceFormOpen(null);
      setServiceFormData({ ...EMPTY_SERVICE_FORM });
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      alert(err?.message || t('machineUpdateFailed'));
    } finally {
      setServiceSaving(false);
    }
  };

  const handleUnassignMachine = async (machineId) => {
    setAssignError('');
    try {
      const data = await secureFetch(
        `/api/owner/machines/${machineId}/assign-operator`,
        {
          method: 'PATCH',
          body: JSON.stringify({ operatorId: null }),
        },
      );
      if (data.success) {
        await fetchOperators();
        const machines = await getMachines();
        const ownerId = sessionUser?.id || sessionUser?.user_id;
        setMachineData(
          Array.isArray(machines)
            ? machines.filter((m) => !ownerId || m.owner_id === ownerId)
            : [],
        );
      } else {
        setAssignError(data.error || t('unassignOperatorFailed'));
      }
    } catch (e) {
      if ((e?.message || '') === 'auth_required') return;
      setAssignError(e?.message || t('genericError'));
    }
  };

  useEffect(() => {
    if (activeTab === 'operators') {
      fetchOperators();
    }
  }, [activeTab]);

  const handleOpSubmit = async () => {
    if (!opData.name.trim() || opData.name.trim().length < 2) {
      setOpError('Name required (min 2 characters)');
      return;
    }
    const phoneClean = opData.phone.replace(/\D/g, '');
    if (phoneClean.length !== 10) {
      setOpError('Valid 10-digit mobile number required');
      return;
    }
    if (opData.password.length < 8) {
      setOpError('Password min 8 characters');
      return;
    }
    if (!opFiles.aadhaarFront || !opFiles.aadhaarBack) {
      setOpError('Aadhaar front and back documents required');
      return;
    }

    setOpSubmitting(true);
    setOpError('');

    try {
      let photoPath = '';
      if (opFiles.photo) {
        const fd = new FormData();
        fd.append('photo', opFiles.photo);
        fd.append('phone', phoneClean);
        const d = await secureFetch('/api/owner/operator/upload-photo', { method: 'POST', body: fd });
        photoPath = d.path || '';
      }

      let licensePath = '';
      if (opFiles.license) {
        const fdL = new FormData();
        fdL.append('license', opFiles.license);
        fdL.append('phone', phoneClean);
        const dL = await secureFetch('/api/owner/operator/upload-license', { method: 'POST', body: fdL });
        licensePath = dL.path || '';
      }

      const fdAF = new FormData();
      fdAF.append('aadhaarFront', opFiles.aadhaarFront);
      fdAF.append('phone', phoneClean);
      const dAF = await secureFetch('/api/owner/operator/upload-aadhaar-front', { method: 'POST', body: fdAF });

      const fdAB = new FormData();
      fdAB.append('aadhaarBack', opFiles.aadhaarBack);
      fdAB.append('phone', phoneClean);
      const dAB = await secureFetch('/api/owner/operator/upload-aadhaar-back', { method: 'POST', body: fdAB });

      let policePath = '';
      if (opFiles.police) {
        const fdP = new FormData();
        fdP.append('policeVerification', opFiles.police);
        fdP.append('phone', phoneClean);
        const dP = await secureFetch('/api/owner/operator/upload-police-verification', { method: 'POST', body: fdP });
        policePath = dP.path || '';
      }

      await secureFetch(
        '/api/owner/operators/create',
        {
          method: 'POST',
          body: JSON.stringify({
            name: opData.name.trim(),
            phone: phoneClean,
            password: opData.password,
            profilePhotoPath: photoPath,
            licenseDocumentPath: licensePath,
            aadhaarFrontPath: dAF.path,
            aadhaarBackPath: dAB.path,
            policeVerificationPath: policePath,
            experienceYears: Number(opData.experienceYears),
            experienceMachineTypes: opData.experienceMachineTypes,
            monthlySalary: Number(opData.monthlySalary),
          }),
        },
      );

      const createdName = opData.name.trim();
      resetOpForm();
      setOpSuccess(`Operator "${createdName}" created — pending admin approval`);
      setShowAddForm(false);
      fetchOperators();
    } catch (err) {
      if ((err?.message || '') === 'auth_required') return;
      setOpError(err.message || 'Something went wrong');
    } finally {
      setOpSubmitting(false);
    }
  };

  const handleRegSubmit = async () => {
    const err = validateRegistrationStep(5, regData, regDocuments, t);
    if (err) {
      setRegError(err);
      return;
    }
    setRegSubmitting(true);
    setRegError('');
    try {
      const formData = new FormData();
      formData.append('data', JSON.stringify(regData));
      Object.entries(regDocuments).forEach(([key, file]) => {
        if (file) formData.append(key, file);
      });
      const result = await submitMachineRegistration(formData);
      setRegSuccess(result.message || t('machineRegistrationSubmitted'));
      resetRegistrationForm();
      const regs = await getOwnerMachineRegistrations();
      setPendingRegistrations(regs.items || []);
    } catch (submitErr) {
      setRegError(submitErr?.message || t('regFailed'));
    } finally {
      setRegSubmitting(false);
    }
  };

  const loadMoreOwnerBookings = async () => {
    if (!ownerBookingsHasMore || ownerBookingsLoadingMore) return;
    setOwnerBookingsLoadingMore(true);
    const result = await getOwnerBookingsPage({ limit: 100, offset: ownerBookingsOffset });
    if ((result.items || []).length > 0) {
      setOwnerBookings((prev) => appendUniqueById(prev, result.items));
      setOwnerBookingsOffset(result.nextOffset ?? ownerBookingsOffset + result.items.length);
      setOwnerBookingsHasMore(Boolean(result.hasMore));
    } else {
      setOwnerBookingsHasMore(false);
    }
    setOwnerBookingsLoadingMore(false);
  };

  const refreshOwnerBookings = async () => {
    const result = await getOwnerBookingsPage({ limit: 100, offset: 0 });
    setOwnerBookings(Array.isArray(result.items) ? result.items : []);
    setOwnerBookingsHasMore(Boolean(result.hasMore));
    setOwnerBookingsOffset(result.nextOffset ?? (result.items?.length || 0));
  };

  const refreshPendingTerminations = useCallback(async (bookings) => {
    const contracts = (bookings || []).filter((b) => b.booking_type === 'contract' && b.id);
    if (contracts.length === 0) {
      setPendingTerminations({});
      return;
    }
    const entries = await Promise.all(contracts.map(async (b) => {
      try {
        const data = await secureFetch(`/api/owner/terminations?bookingId=${encodeURIComponent(b.id)}`);
        return [b.id, data?.termination || null];
      } catch (_err) {
        return [b.id, null];
      }
    }));
    const map = {};
    entries.forEach(([id, term]) => {
      if (term) map[id] = term;
    });
    setPendingTerminations(map);
  }, []);

  useEffect(() => {
    refreshPendingTerminations(ownerBookings);
  }, [ownerBookings, refreshPendingTerminations]);

  const estimateOwnerTerminationFee = (booking, type) => {
    if (type === 'mutual' || type === 'force_majeure') {
      return { remaining: 0, feeCycles: 0, gross: 0, gst: 0, net: 0 };
    }
    const start = new Date(`${String(booking.start_date || '').slice(0, 10)}T00:00:00`);
    const end = new Date(`${String(booking.end_date || '').slice(0, 10)}T00:00:00`);
    let remaining = 0;
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      const months = String(booking.billing_cycle || '').toLowerCase() === 'quarterly' ? 3 : 1;
      remaining = 1;
      const cursor = new Date(start);
      while (remaining < 120) {
        cursor.setMonth(cursor.getMonth() + months);
        if (cursor >= end) break;
        remaining += 1;
      }
    }
    const feeCycles = Math.min(remaining, 3);
    const rate = Number(booking.fixed_rate_per_cycle || 0);
    const gross = Math.round(feeCycles * rate * 0.25 * 100) / 100;
    const gst = Math.round(gross * 0.18 * 100) / 100;
    const net = Math.round((gross + gst) * 100) / 100;
    return { remaining, feeCycles, gross, gst, net };
  };

  const handleOwnerInitiateTermination = async () => {
    if (!terminationModal || terminationSubmitting) return;
    if (terminationType === 'force_majeure' && !String(forceMajeureReason || '').trim()) {
      setTerminationError('Enter force majeure reason');
      return;
    }
    setTerminationSubmitting(true);
    setTerminationError('');
    try {
      const result = await secureFetch('/api/owner/terminations/initiate', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: terminationModal.id,
          terminationType,
          forceMajeureReason: terminationType === 'force_majeure' ? forceMajeureReason : null,
        }),
      });
      if (result?.success === false) {
        throw new Error(result.message || 'Termination request failed');
      }
      setPendingTerminations((prev) => ({
        ...prev,
        [terminationModal.id]: result.termination || { status: 'pending' },
      }));
      setTerminationModal(null);
      setForceMajeureReason('');
    } catch (err) {
      setTerminationError(err?.message || 'Termination request failed');
    } finally {
      setTerminationSubmitting(false);
    }
  };

  const hasLiveOwnerBooking = useMemo(
    () => ownerBookings.some(bookingNeedsLiveSync),
    [ownerBookings],
  );

  useEffect(() => {
    if (!hasLiveOwnerBooking) return undefined;
    const id = setInterval(() => {
      refreshOwnerBookings();
    }, 5000);
    return () => clearInterval(id);
  }, [hasLiveOwnerBooking]);

  function fuelDisplay(fuelPct, capacityLitres) {
    if (capacityLitres > 0) {
      const litres = Math.round(
        (fuelPct / 100) * capacityLitres,
      );
      return `${litres}L / ${capacityLitres}L`;
    }
    return `${fuelPct}%`;
  }

  const displayMachines = machineData.map((m) => {
    const activeBooking = (ownerBookings || []).find((b) =>
      b.machine_id === m.id
      && ['Dispatched', 'Extension_Pending', 'Completing'].includes(b.status),
    ) || null;
    return {
      id: m.machine_id, name: m.name, type: m.type, regNo: m.reg_no, year: m.year,
      status: m.status || 'Idle', client: 'N/A',
      rtoApplicable: m.reg_no !== 'TRACKED-NO-RTO',
      fuel: Number(m.fuel_level ?? 0),
      fuelCapacity: Number(m.fuel_capacity_litres || 0),
      hmr: activeBooking
        ? runningElapsedMs(activeBooking) / 3600000
        : 0,
      activeBooking,
      operator: m.operator || null,
    };
  });

  const totalMachineCount = displayMachines.length;
  const activeMachineCount = displayMachines.filter((m) => String(m.status).toLowerCase() === 'active').length;

  const machinesMissingPurchasePrice = useMemo(
    () => machineData.filter((m) => {
      const price = Number(m.purchase_price);
      return m.purchase_price == null || m.purchase_price === ''
        || !Number.isFinite(price) || price <= 0;
    }),
    [machineData],
  );
  const missingPurchaseCount = machinesMissingPurchasePrice.length;

  const scrollToFirstMissingPurchase = () => {
    const targetId = machinesMissingPurchasePrice[0]?.id;
    if (!targetId) return;
    document.getElementById(`owner-machine-${targetId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const ownerKycRegistrationBlocked = ownerKycStatus === 'rejected';

  const renderOwnerKycBanner = () => {
    if (!ownerKycStatus || ownerKycStatus === 'approved') return null;
    let bannerStyle;
    let message;
    let showKycLink = false;
    if (ownerKycStatus === 'rejected') {
      bannerStyle = {
        background: 'rgba(233,69,96,0.12)',
        border: '1px solid rgba(233,69,96,0.35)',
        color: '#e94560',
      };
      message = t('kycRejectedWarning');
      showKycLink = true;
    } else if (ownerKycStatus === 'not_submitted') {
      bannerStyle = {
        background: 'rgba(255,152,0,0.12)',
        border: '1px solid rgba(255,152,0,0.35)',
        color: '#FF9800',
      };
      message = t('kycNotSubmittedHint');
      showKycLink = true;
    } else if (ownerKycStatus === 'pending') {
      bannerStyle = {
        background: 'rgba(33,150,243,0.12)',
        border: '1px solid rgba(33,150,243,0.35)',
        color: '#2196F3',
      };
      message = t('kycPendingHint');
    } else {
      return null;
    }
    return (
      <div
        style={{
          ...bannerStyle,
          borderRadius: '10px',
          padding: '10px 12px',
          marginBottom: '15px',
          fontSize: '12px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <p style={{ margin: 0, flex: '1 1 200px' }}>{message}</p>
        {showKycLink ? (
          <button
            type="button"
            onClick={() => setActiveTab('kyc')}
            style={{
              background: 'transparent',
              border: `1px solid ${bannerStyle.color}`,
              color: bannerStyle.color,
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            {t('kycGoToTab')} →
          </button>
        ) : null}
      </div>
    );
  };

  const handleLogout = () => {
    logoutAndRedirect(navigate);
  };

  const localAlerts = [];
  const localAlertTime = new Date().toISOString();
  if (ownerKycStatus !== 'approved' && ownerKycStatus !== 'rejected') {
    localAlerts.push({
      id: 'local_kyc',
      type: 'local_kyc',
      icon: '🪪',
      msg: ownerKycStatus === 'pending' ? t('kycPendingHint') : t('kycNotSubmittedHint'),
      time: localAlertTime,
      color: '#FF9800',
      link: 'kyc',
    });
  }
  const pushEnabled = readSessionUser()?.pushNotificationsEnabled;
  if (!pushEnabled) {
    localAlerts.push({
      id: 'local_push',
      type: 'local_push',
      icon: '🔔',
      msg: t('pushEnablePrompt'),
      time: localAlertTime,
      color: '#FF9800',
      link: 'alerts',
    });
  }
  const allAlerts = [...localAlerts, ...alerts];

  const navItemsWithBadge = navItems.map((item) => ({
    ...item,
    ...(item.id === 'alerts' && allAlerts.length > 0
      ? { badge: allAlerts.length > 99 ? '99+' : allAlerts.length }
      : {}),
  })).filter((item) =>
    item.id !== 'edit-registration' || machineData.length > 0
  );

  const renderNavBadge = (badge) => {
    if (!badge) return null;
    return (
      <span
        style={{
          marginLeft: 'auto',
          minWidth: '18px',
          height: '18px',
          padding: '0 5px',
          borderRadius: '999px',
          background: '#e94560',
          color: '#fff',
          fontSize: '10px',
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        {badge}
      </span>
    );
  };

  const renderGroupedNavButtons = (items, { onItemClick } = {}) => {
    const nodes = [];
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      if (!item.sectionKey) {
        if (index > 0 && items[index - 1]?.sectionKey) {
          nodes.push(<div key={`section-end-${item.id}`} style={s.divider} />);
        }
        nodes.push(
          <button
            key={item.id}
            type="button"
            style={activeTab === item.id ? s.navActive : s.nav}
            onClick={() => {
              setActiveTab(item.id);
              if (typeof onItemClick === 'function') onItemClick(item);
            }}
          >
            <span>{item.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
            {renderNavBadge(item.badge)}
          </button>,
        );
        index += 1;
        continue;
      }

      const sectionKey = item.sectionKey;
      const sectionLabel = item.sectionLabel || sectionKey;
      const groupItems = [];
      while (index < items.length && items[index].sectionKey === sectionKey) {
        groupItems.push(items[index]);
        index += 1;
      }
      const open = isNavSectionOpen(sectionKey);
      const groupBadge = sumNavBadges(groupItems);
      nodes.push(
        <div key={`section-${sectionKey}`} style={{ width: '100%' }}>
          <div style={s.divider} />
          <button
            type="button"
            style={s.navSectionToggle}
            aria-expanded={open}
            onClick={() => toggleNavSection(sectionKey)}
          >
            <span style={s.navSectionChevron} aria-hidden>{open ? '▼' : '▶'}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{sectionLabel}</span>
            {groupBadge != null ? renderNavBadge(groupBadge) : null}
          </button>
          <div
            style={{
              maxHeight: open ? 320 : 0,
              opacity: open ? 1 : 0,
              overflow: 'hidden',
              transition: 'max-height 300ms ease, opacity 300ms ease',
            }}
          >
            {groupItems.map((groupItem) => (
              <button
                key={groupItem.id}
                type="button"
                style={activeTab === groupItem.id ? s.navActive : s.nav}
                onClick={() => {
                  setActiveTab(groupItem.id);
                  if (typeof onItemClick === 'function') onItemClick(groupItem);
                }}
              >
                <span>{groupItem.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{groupItem.label}</span>
                {renderNavBadge(groupItem.badge)}
              </button>
            ))}
          </div>
        </div>,
      );
    }
    return nodes;
  };

  return (
    <div
      className={useMobileNav ? 'portal-dashboard-shell--phone' : ''}
      style={useMobileNav ? s.containerMobile : s.container}
    >
      {/* Mobile Nav */}
      {useMobileNav && (
        <MobileNav
          navItems={navItemsWithBadge}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          title={t('appName')}
          subtitle={t('ownerPortal')}
          drawerMode="full"
          drawerSectionTitle={t('drawerMenu')}
          hideBottomNav
          collapsibleSections
          navSectionOpen={navSectionOpen}
          onToggleNavSection={toggleNavSection}
          topContent={
            <div style={{ padding: '4px 0' }}>
              <p style={{ color: '#c9a84c', fontWeight: '700', fontSize: '13px', margin: '0 0 2px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                {ownerDisplayName}
                <OwnerTierBadge tier={ownerTier} />
                <AccountStatusPill status={sessionUser.status} />
              </p>
              <p style={{ color: '#8896a8', fontSize: '11px', margin: 0 }}>🚜 {totalMachineCount} Machines · Since {ownerSince}</p>
            </div>
          }
          bottomContent={
            <button style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(233,69,96,0.3)', background: 'rgba(233,69,96,0.08)', color: '#e94560', cursor: 'pointer', fontSize: '13px', width: '100%' }} onClick={handleLogout}>🚪 {t('logout')}</button>
          }
        />
      )}

      {/* Tablet overlay sidebar */}
      {!useMobileNav && sidebarOverlay && (
        <>
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              style={{
                position: 'fixed', inset: 0,
                zIndex: 30,
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(1px)',
              }}
            />
          )}
          <div style={{
            ...s.sidebar,
            position: 'fixed',
            left: 0, top: 0,
            zIndex: 40,
            height: '100svh',
            maxHeight: '100svh',
            transform: sidebarOpen
              ? 'translateX(0)'
              : 'translateX(-100%)',
            transition: 'transform 300ms ease',
            pointerEvents: sidebarOpen ? 'auto' : 'none',
          }}>
            <div style={s.sidebarHeader}>
              <div style={s.sidebarHeaderBrand}>
                <div style={s.logoCircle}>DE</div>
                <div>
                  <p style={s.logoTitle}>{t('appName')}</p>
                  <p style={s.logoSub}>{t('ownerPortal')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                style={s.sidebarToggleBtn}
                aria-label="Close sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div style={s.divider} />
            {renderGroupedNavButtons(navItemsWithBadge, {
              onItemClick: () => { if (sidebarOverlay) setSidebarOpen(false); },
            })}
            <div style={s.divider} />
            <button style={s.logoutBtn} onClick={handleLogout}>🚪 {t('logout')}</button>
            <p style={s.sidebarFooter}>{t('sinceExcellence')}</p>
          </div>
        </>
      )}

      {!useMobileNav && !sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          style={s.sidebarOpenFab}
          aria-label="Open sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}

      {/* Desktop sticky sidebar */}
      {!useMobileNav && !sidebarOverlay && sidebarOpen && (
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>
            <div style={s.sidebarHeaderBrand}>
              <div style={s.logoCircle}>DE</div>
              <div>
                <p style={s.logoTitle}>{t('appName')}</p>
                <p style={s.logoSub}>{t('ownerPortal')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              style={s.sidebarToggleBtn}
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div style={s.divider} />
          {renderGroupedNavButtons(navItemsWithBadge)}
          <div style={s.divider} />
          <button style={s.logoutBtn} onClick={handleLogout}>🚪 {t('logout')}</button>
          <p style={s.sidebarFooter}>{t('sinceExcellence')}</p>
        </div>
      )}

      {/* Main */}
      <div className={useMobileNav ? 'portal-dashboard-main-wrap--phone' : 'portal-dashboard-scroll-shell'} style={useMobileNav ? undefined : s.scrollShell}>
      <div
        className={useMobileNav ? 'portal-dashboard-main--phone' : 'portal-dashboard-main--locked'}
        style={{
          ...(useMobileNav ? s.mainMobile : s.main),
          ...(useMobileNav
            ? { padding: 'calc(70px + env(safe-area-inset-top, 0px)) 12px calc(16px + env(safe-area-inset-bottom, 0px))' }
            : isMobile
              ? { padding: '20px 16px' }
              : {
                  padding: !sidebarOpen ? '25px 25px 25px 60px' : '25px',
                  paddingTop: sidebarOverlay ? 'calc(20px + env(safe-area-inset-top, 0px))' : '25px',
                }),
        }}
      >
        {/* Header */}
        <div style={{ ...s.header, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '8px' : '0', alignItems: isMobile ? 'flex-start' : 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ minWidth: 0, maxWidth: '100%' }}>
              <h2 style={{ ...s.pageTitle, fontSize: isMobile ? '16px' : '20px' }}>
                {navItems.find(n => n.id === activeTab)?.icon}{' '}{navItems.find(n => n.id === activeTab)?.label}
              </h2>
              {!useMobileNav && (
              <p style={s.pageDate}>📅 {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '100%' }}>
            {!useMobileNav && <LanguageSelector compact={true} />}
            {!useMobileNav && (
              <div style={s.ownerBadge}>
                <span style={s.onlineDot}></span>
                🏗️ {ownerDisplayName}
                <OwnerTierBadge tier={ownerTier} />
                <AccountStatusPill status={sessionUser.status} />
              </div>
            )}
          </div>
        </div>
        {termsPrompt.visible && (
          <div style={{ marginBottom: '12px', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: '10px', padding: '10px 12px' }}>
            <p style={{ color: '#c9a84c', fontSize: '12px', margin: '0 0 6px', fontWeight: 700 }}>
              Terms update available
            </p>
            <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 8px', lineHeight: 1.45 }}>
              Please review the latest platform Terms & Conditions ({termsPrompt.currentVersion}) and acknowledge once.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.45)', color: '#c9a84c', borderRadius: '8px', padding: '7px 12px', fontSize: '11px', fontWeight: 700 }}
              >
                Open Terms
              </a>
              <button
                type="button"
                onClick={handleAcknowledgeTerms}
                disabled={termsPrompt.acknowledging}
                style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.5)', color: '#4CAF50', borderRadius: '8px', padding: '7px 12px', fontSize: '11px', fontWeight: 700, cursor: termsPrompt.acknowledging ? 'wait' : 'pointer' }}
              >
                {termsPrompt.acknowledging ? 'Saving...' : 'I have read and agree'}
              </button>
              <button
                type="button"
                onClick={() => setTermsPrompt((prev) => ({ ...prev, visible: false }))}
                style={{ background: 'transparent', border: '1px solid rgba(136,150,168,0.45)', color: '#8896a8', borderRadius: '8px', padding: '7px 12px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
              >
                Later
              </button>
            </div>
            {termsPrompt.error ? (
              <p style={{ color: '#e94560', fontSize: '11px', margin: '8px 0 0' }}>{termsPrompt.error}</p>
            ) : null}
          </div>
        )}

        {activeTab === 'dashboard' && isBankIncomplete && (
          <div style={{
            background: 'rgba(255,152,0,0.12)',
            border: '1px solid rgba(255,152,0,0.4)',
            borderRadius: 10,
            padding: '10px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
          >
            <div style={{ display: 'flex',
              alignItems: 'center', gap: 8 }}
            >
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div>
                <p style={{
                  color: '#FF9800',
                  fontWeight: 700,
                  fontSize: 13,
                  margin: 0,
                }}
                >
                  {t('ownerBankDetailsIncomplete')}
                </p>
                <p style={{
                  color: '#8896a8',
                  fontSize: 11,
                  margin: '2px 0 0',
                }}
                >
                  {t('ownerPayoutBlockedNoBank')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              style={{
                background: 'rgba(255,152,0,0.2)',
                border: '1px solid rgba(255,152,0,0.5)',
                color: '#FF9800',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {t('ownerAddBankDetailsBtn')}
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && ownerTier === 'lite' && !liteUpgradeDismissed && (
          <div style={{
            background: 'rgba(201,168,76,0.1)',
            border: '1px solid rgba(201,168,76,0.4)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 12,
          }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 220px' }}>
                <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, margin: '0 0 6px' }}>
                  Upgrade to Verified to unlock contract bookings + higher search ranking.
                </p>
                <p style={{ color: '#8896a8', fontSize: 11, margin: 0, lineHeight: 1.45 }}>
                  Complete KYC → Add bank details → Get verified automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={dismissLiteUpgradeBanner}
                aria-label="Dismiss"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(136,150,168,0.4)',
                  color: '#8896a8',
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  lineHeight: 1.4,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setActiveTab('kyc')}
                style={{
                  background: 'linear-gradient(135deg, #a07830, #e2c97e)',
                  border: 'none',
                  color: '#0a1628',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Complete KYC →
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                style={{
                  background: 'rgba(201,168,76,0.12)',
                  border: '1px solid rgba(201,168,76,0.45)',
                  color: '#c9a84c',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Add Bank Details →
              </button>
            </div>
          </div>
        )}

        {/* ═══ TAB: DASHBOARD ═══ */}
        {activeTab === 'bookings' && (() => {
          const TERMINAL = ['Cancelled', 'Canceled', 'Completed', 'Disputed'];
          return (
          <div>
            <div style={{ ...s.tableCard, marginBottom: '16px', border: pendingQuotations.length > 0 ? '1px solid rgba(255,152,0,0.4)' : '1px solid rgba(201,168,76,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <h3 style={{ ...s.tableTitle, margin: 0 }}>Pending quotations</h3>
                <button
                  type="button"
                  onClick={loadPendingQuotations}
                  style={{ background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', borderRadius: '8px', padding: '6px 12px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Refresh
                </button>
              </div>
              {pendingQuotationsLoading && (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              )}
              {!pendingQuotationsLoading && pendingQuotationsError && (
                <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{pendingQuotationsError}</p>
              )}
              {!pendingQuotationsLoading && !pendingQuotationsError && pendingQuotations.length === 0 && (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>No contract quotations awaiting your response.</p>
              )}
              {!pendingQuotationsLoading && pendingQuotations.map((q) => {
                const machineLabel = q.machine?.machineId || q.machine?.name || q.machineId || '—';
                const deadlineLabel = q.ownerResponseDeadline
                  ? new Date(q.ownerResponseDeadline).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : '—';
                const busy = quotationActionId === q.id;
                return (
                  <div
                    key={q.id}
                    style={{
                      background: 'linear-gradient(135deg, #0a1628, #060e1c)',
                      border: '1px solid rgba(255,152,0,0.35)',
                      borderRadius: '10px',
                      padding: '14px',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                      <div>
                        <span style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>
                          {q.quotationRef || q.id}
                        </span>
                        <span style={{ marginLeft: '8px', color: '#8896a8', fontSize: '11px' }}>{machineLabel}</span>
                      </div>
                      <span style={{ background: 'rgba(255,152,0,0.15)', border: '1px solid #FF9800', color: '#FF9800', padding: '3px 10px', borderRadius: '20px', fontSize: '11px' }}>
                        Respond by {deadlineLabel}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                      <div>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Dates</p>
                        <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>{q.startDate || '—'} → {q.endDate || '—'}</p>
                      </div>
                      <div>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Rate / cycle</p>
                        <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>₹{Number(q.fixedRatePerCycle || 0).toLocaleString('en-IN')}</p>
                      </div>
                      <div>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Advance (later)</p>
                        <p style={{ color: '#c9a84c', fontSize: '12px', fontWeight: 700, margin: '2px 0 0' }}>₹{Number(q.advanceRequired || 0).toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setQuotationSnapshotOpenId((prev) => (prev === q.id ? null : q.id))}
                        style={{ background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        {quotationSnapshotOpenId === q.id ? 'Hide quotation terms snapshot' : 'View quotation terms snapshot'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAcceptQuotation(q)}
                        style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid #4CAF50', color: '#4CAF50', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                      >
                        {busy ? t('loading') : 'Accept'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRejectQuotation(q)}
                        style={{ background: 'rgba(233,69,96,0.12)', border: '1px solid #e94560', color: '#e94560', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                      >
                        Reject
                      </button>
                    </div>
                    {quotationSnapshotOpenId === q.id && (
                      <div style={{ marginTop: '10px', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '8px', padding: '10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Legal terms version</p>
                            <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>{q.legalTermsVersion || '—'}</p>
                          </div>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Client accepted at</p>
                            <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>
                              {q.clientTermsAcceptedAt ? new Date(q.clientTermsAcceptedAt).toLocaleString('en-IN') : 'Not captured'}
                            </p>
                          </div>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Billing cycle</p>
                            <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>{q.billingCycle || '—'}</p>
                          </div>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Rate / cycle</p>
                            <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>₹{Number(q.fixedRatePerCycle || 0).toLocaleString('en-IN')}</p>
                          </div>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Guaranteed hours / cycle</p>
                            <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '2px 0 0' }}>{q.guaranteedHoursPerCycle || '—'}</p>
                          </div>
                          <div>
                            <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>Contract total</p>
                            <p style={{ color: '#c9a84c', fontSize: '12px', margin: '2px 0 0', fontWeight: 700 }}>₹{Number(q.contractTotal || 0).toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: '#c9a84c', fontSize: '11px', fontWeight: 700, textDecoration: 'underline' }}>
                            Open platform Terms & Conditions
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: gridCols(2, 3, 3), gap: '12px', marginBottom: '20px' }}>
              {[
                { icon: String.fromCodePoint(0x1F4CB), val: ownerBookings.length.toString(), label: t('totalBookingsText') },
                { icon: String.fromCodePoint(0x23F3), val: (pendingQuotations.length + ownerBookings.filter((b) => !b.owner_approved && !TERMINAL.includes(b.status)).length).toString(), label: t('pendingApproval') },
                { icon: String.fromCodePoint(0x2705), val: ownerBookings.filter((b) => b.status === 'Completed').length.toString(), label: t('approved') },
              ].map((c, i) => (
                <div key={i} style={s.card}><p style={{ fontSize: '22px', margin: '0 0 6px' }}>{c.icon}</p><h3 style={{ color: '#c9a84c', fontSize: '20px', fontWeight: '700', margin: '0 0 4px' }}>{c.val}</h3><p style={{ color: '#8896a8', fontSize: '11px', margin: 0 }}>{c.label}</p></div>
              ))}
            </div>
            {ownerBookingsLoading && (
              <div style={{ ...s.tableCard, textAlign: 'center', padding: '32px' }}>
                <p style={{ color: '#c9a84c', margin: 0 }}>{t('loading')}</p>
              </div>
            )}
            {!ownerBookingsLoading && ownerBookingsError && (
              <div style={{ ...s.tableCard, border: '1px solid rgba(233,69,96,0.4)', textAlign: 'center', padding: '24px' }}>
                <p style={{ color: '#e94560', margin: 0 }}>{ownerBookingsError}</p>
              </div>
            )}
            {!ownerBookingsLoading && !ownerBookingsError && groupedOwnerBookings.length === 0 && (
              <div style={{ ...s.tableCard, textAlign: 'center', padding: '32px' }}>
                <p style={{ fontSize: '32px', margin: '0 0 8px' }}>{String.fromCodePoint(0x1F4CB)}</p>
                <p style={{ color: '#c9a84c', fontWeight: 700, margin: '0 0 4px' }}>{t('noBookingsYet')}</p>
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('bookingsScheduleHint')}</p>
              </div>
            )}
            {!ownerBookingsLoading && groupedOwnerBookings.map(({ month, dayGroups }) => (
              <OwnerMonthAccordion
                key={month}
                month={month}
                dayGroups={dayGroups}
                bookingGridCols={gridCols(2, 3, 3)}
                setOwnerBookings={setOwnerBookings}
                onBookingRefresh={refreshOwnerBookings}
                t={t}
                machineLookup={machineLookup}
                approvingId={approvingId}
                completingId={completingId}
                onApprove={handleApproveBooking}
                onComplete={handleCompleteBooking}
                ownerTier={ownerTier}
                approveErrorByBookingId={approveErrorByBookingId}
                awaitingMobQuotations={awaitingMobQuotations}
                confirmedMobQuotations={confirmedMobQuotations}
                mobilizationReleasedByBookingId={mobilizationReleasedByBookingId}
                convertedBookingIds={convertedBookingIds}
                mobilizationActionId={mobilizationActionId}
                convertActionId={convertActionId}
                onConfirmMobilization={handleConfirmMobilization}
                onConvertQuotation={handleConvertQuotation}
                onOpenLoadingMilestone={(b) => {
                  setLoadingMilestoneError('');
                  setLoadingPhotoFile(null);
                  setLoadingReceiptFile(null);
                  setLoadingMilestoneModal(b);
                }}
                loadingMilestoneBusyId={loadingMilestoneBusyId}
                pendingTerminations={pendingTerminations}
                onRequestTermination={(b) => {
                  setTerminationType('owner');
                  setForceMajeureReason('');
                  setTerminationError('');
                  setTerminationModal(b);
                }}
              />
            ))}
            {ownerBookingsHasMore && (
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                <button
                  style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', borderRadius: '8px', padding: '8px 14px', cursor: ownerBookingsLoadingMore ? 'wait' : 'pointer', opacity: ownerBookingsLoadingMore ? 0.7 : 1 }}
                  disabled={ownerBookingsLoadingMore}
                  onClick={loadMoreOwnerBookings}
                >
                  {ownerBookingsLoadingMore ? t('loading') : t('loadMoreBookings')}
                </button>
              </div>
            )}
            <p style={{ color: '#8896a8', fontSize: '11px', textAlign: 'center', margin: '8px 0 0' }}>
              {t('loadedOwnerBookings')
                .replace('{count}', ownerBookings.length)
                .replace('{suffix}', ownerBookingsHasMore ? t('ownerBookingsMoreAvailable') : t('ownerBookingsAllLoaded'))}
            </p>
          </div>
          );
        })()}
        {activeTab === 'dashboard' && (
          <div>
            {(() => {
              const now = new Date();
              const monthNames = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December',
              ];
              const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
              const dashSectionTitle = {
                color: '#c9a84c',
                marginBottom: 14,
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                borderLeft: '3px solid #C9A84C',
                paddingLeft: 8,
              };
              return (
                <>
            <div style={{ ...s.cardRow, gridTemplateColumns: gridCols(2, 3, 4) }}>
              {[
                { val: `${totalMachineCount}`, label: t('totalMachines'), sub: t('myMachines') },
                { val: `${activeMachineCount}`, label: t('activeToday'), sub: 'Today' },
                { val: fmtKpiAmount(reportSettlementStats.thisMonth), label: t('netEarnedMonth'), sub: monthLabel },
                { val: fmtKpiAmount(dashboardSettlementStats.gross), label: t('grossBilling'), sub: monthLabel },
              ].map((c, i) => (
                <div key={i} style={s.card}>
                  <p style={{
                    color: '#8896a8',
                    fontSize: 11,
                    margin: '0 0 6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                  >
                    {c.label}
                  </p>
                  <h3 style={{
                    color: '#e8e0d0',
                    fontSize: 24,
                    fontWeight: 700,
                    margin: '0 0 4px',
                  }}
                  >
                    {c.val}
                  </h3>
                  {c.sub ? (
                    <p style={{ color: '#C9A84C', fontSize: 10, margin: 0 }}>{c.sub}</p>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Commission Breakdown */}
            <div style={s.commissionCard}>
              <h3 style={dashSectionTitle}>
                Payment Breakdown — {monthLabel}
              </h3>
              {settlementsLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              ) : settlementsError ? (
                <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{settlementsError}</p>
              ) : settlements.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('ownerNoPaymentsYet')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {[
                    { label: t('grossBilling'), val: fmtInr(dashboardSettlementStats.gross), color: '#c9a84c' },
                    { label: t('commission15'), val: `- ${fmtInr(dashboardSettlementStats.commission)}`, color: '#e94560' },
                    { label: t('tdsGstTcs'), val: `- ${fmtInr(dashboardSettlementStats.tdsTcs)}`, color: '#e94560' },
                    { label: t('netReceivedCaps'), val: fmtInr(dashboardSettlementStats.net), color: '#C9A84C', emphasize: true },
                  ].map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                      }}
                    >
                      <span style={{ color: '#8896a8', fontSize: 12 }}>{item.label}</span>
                      <span style={{
                        color: item.color,
                        fontWeight: 700,
                        fontSize: item.emphasize ? 15 : 13,
                        textAlign: 'right',
                      }}
                      >
                        {item.val}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Payments */}
            <div style={s.tableCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ ...dashSectionTitle, margin: 0 }}>{t('ownerRecentPayments')}</h3>
                {settlements.length > 0 && (
                  <button
                    type="button"
                    style={s.downloadBtn}
                    onClick={() => setActiveTab('reports')}
                  >
                    {t('ownerViewAllPayments')} →
                  </button>
                )}
              </div>
              {settlementsLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              ) : settlementsError ? (
                <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{settlementsError}</p>
              ) : recentSettlements.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('ownerNoPaymentsYet')}</p>
              ) : (
                recentSettlements.map((row) => {
                  const dateLabel = row.created_at
                    ? new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                  return (
                    <div
                      key={row.id || row.booking_ref}
                      style={{
                        ...s.alertRow,
                        borderLeft: `3px solid ${settlementStatusColor(row.status)}`,
                        marginBottom: 6,
                        padding: '8px 10px',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>💰</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '0 0 2px' }}>
                          {row.booking_ref || '—'} · {fmtInr(row.net_owner_amount)}
                        </p>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>
                          {dateLabel} · {settlementStatusLabel(row.status)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Machine Status */}
            <div style={s.tableCard}>
              <h3 style={dashSectionTitle}>{t('machineStatusTitle')}</h3>
              {displayMachines.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', textAlign: 'center', margin: 0, padding: '16px 0' }}>{t('noMachinesDashboard')}</p>
              ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {displayMachines.map((m, i) => (
                  <div
                    key={m.id || i}
                    style={{
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(201,168,76,0.15)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 6,
                    }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          color: '#e8e0d0',
                          fontWeight: 700,
                          fontSize: 13,
                          margin: 0,
                          wordBreak: 'break-word',
                        }}
                        >
                          {m.name || m.id}
                        </p>
                        <p style={{ color: '#8896a8', fontSize: 10, margin: '2px 0 0' }}>
                          {m.id}{m.regNo ? ` · ${m.regNo}` : ''}
                        </p>
                      </div>
                      <span style={{
                        ...s.statusBadge,
                        flexShrink: 0,
                        background: m.status === 'Active' ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)',
                        border: `1px solid ${m.status === 'Active' ? '#4CAF50' : '#FF9800'}`,
                        color: m.status === 'Active' ? '#4CAF50' : '#FF9800',
                      }}
                      >
                        {statusLabel(m.status, t)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                      <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                        {t('hmrToday')}:{' '}
                        <span style={{ color: '#e8e0d0', fontWeight: 600 }}>{formatHoursHm(m.hmr)}</span>
                      </p>
                      <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                        {t('client')}:{' '}
                        <span style={{ color: '#e8e0d0', fontWeight: 600 }}>{m.client}</span>
                      </p>
                      <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                        {t('fuel')}:{' '}
                        <span style={{
                          color: m.fuel > 30 ? '#4CAF50' : '#e94560',
                          fontWeight: 700,
                        }}
                        >
                          {fuelDisplay(m.fuel, m.fuelCapacity)}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>

            {/* Alerts */}
            <div style={s.tableCard}>
              <h3 style={dashSectionTitle}>{t('recentAlerts')}</h3>
              {alertsLoading && allAlerts.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: 13 }}>{t('loading')}</p>
              ) : allAlerts.length > 0 ? (
                allAlerts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    style={{
                      ...s.alertRow,
                      borderLeft: `3px solid ${a.color}`,
                      padding: '8px 10px',
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{a.icon}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ color: '#e8e0d0', fontSize: '12px', margin: '0 0 2px' }}>{ownerAlertMsg(a, t)}</p>
                      <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>
                        {a.time ? new Date(a.time).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p style={{ color: '#8896a8', fontSize: 13 }}>
                  {t('noAlertsNow')}
                </p>
              )}
            </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ═══ TAB: MY MACHINES / EDIT REGISTRATION INFO ═══ */}
        {(activeTab === 'machines' || activeTab === 'edit-registration') && (
          <div>
            {activeTab === 'edit-registration' && (
              <div style={{ ...s.tableCard, marginBottom: 15 }}>
                <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>
                  {t('editRegistrationInfo')}
                </p>
                <p style={{ color: '#8896a8', fontSize: 12, margin: '0 0 12px' }}>
                  {t('editRegistrationInfoHint')}
                </p>
                <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 4 }}>
                  {t('editRegistrationPickMachine')}
                </label>
                <select
                  className="de-owner-input"
                  value={editRegSelectedId || ''}
                  onChange={(e) => {
                    const nextId = e.target.value || null;
                    setEditRegSelectedId(nextId);
                    setEditingMachineId(null);
                    setEditMachineForm({});
                    setEditingFinancialMachineId(null);
                    setEditingComplianceId(null);
                  }}
                  style={{ width: '100%', maxWidth: 420 }}
                >
                  <option value="">{t('editRegistrationPickPlaceholder')}</option>
                  {displayMachines.map((m) => {
                    const raw = machineData.find((r) => r.machine_id === m.id);
                    if (!raw?.id) return null;
                    return (
                      <option key={raw.id} value={raw.id}>
                        {m.name} · {m.id} · {m.regNo}
                      </option>
                    );
                  })}
                </select>
                {displayMachines.length === 0 && (
                  <p style={{ color: '#8896a8', fontSize: 12, margin: '12px 0 0' }}>
                    {t('noMachinesYet')}
                  </p>
                )}
                {displayMachines.length > 0 && !editRegSelectedId && (
                  <p style={{ color: '#8896a8', fontSize: 12, margin: '12px 0 0' }}>
                    {t('editRegistrationSelectPrompt')}
                  </p>
                )}
              </div>
            )}
            {activeTab === 'machines' && renderOwnerKycBanner()}
            {activeTab === 'machines' && missingPurchaseCount > 0 && (
              <button
                type="button"
                onClick={scrollToFirstMissingPurchase}
                style={{
                  display: 'block',
                  width: '100%',
                  marginBottom: 15,
                  padding: '12px 14px',
                  textAlign: 'left',
                  background: 'rgba(255,152,0,0.12)',
                  border: '1px solid rgba(255,152,0,0.35)',
                  borderRadius: 8,
                  color: '#FF9800',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('recoveryBackfillNudge').replace('{{count}}', missingPurchaseCount)}
              </button>
            )}
            {activeTab === 'machines' && displayMachines.length === 0 && (
              <div style={{ ...s.tableCard, textAlign: 'center', padding: '32px' }}>
                <p style={{ fontSize: '32px', margin: '0 0 8px' }}>{String.fromCodePoint(0x1F69C)}</p>
                <p style={{ color: '#c9a84c', fontWeight: 700, margin: '0 0 8px' }}>{t('noMachinesYet')}</p>
                {ownerKycRegistrationBlocked ? (
                  <p style={{ color: '#e94560', fontSize: '12px', margin: '0 0 12px' }}>{t('kycRejectedWarning')}</p>
                ) : null}
                <button
                  type="button"
                  style={{
                    ...s.confirmBtn,
                    ...(ownerKycRegistrationBlocked ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                  }}
                  disabled={ownerKycRegistrationBlocked}
                  onClick={() => setActiveTab('register')}
                >
                  + {t('registerMachine')}
                </button>
              </div>
            )}
            {(activeTab === 'machines'
              ? displayMachines
              : displayMachines.filter((m) => {
                const raw = machineData.find((r) => r.machine_id === m.id);
                return Boolean(editRegSelectedId && raw?.id === editRegSelectedId);
              })
            ).map((m, i) => {
              const raw = machineData.find((r) => r.machine_id === m.id);
              const machineUuid = raw?.id;
              return (
              <div
                key={i}
                id={machineUuid ? `owner-machine-${machineUuid}` : undefined}
                style={{ ...s.tableCard, marginBottom: '15px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <p style={{ color: '#c9a84c', fontWeight: '700', fontSize: '15px', margin: '0 0 3px' }}>{m.name}</p>
                    <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 2px' }}>{m.id} · {m.regNo} · Year: {m.year}</p>
                  </div>
                  <span style={{ ...s.statusBadge, background: m.status === 'Active' ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)', border: `1px solid ${m.status === 'Active' ? '#4CAF50' : '#FF9800'}`, color: m.status === 'Active' ? '#4CAF50' : '#FF9800' }}>{statusLabel(m.status, t)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: gridCols(2, 3, 4), gap: '10px', marginBottom: '12px' }}>
                  {[
                    { label: `👷 ${t('client')}`, val: m.client },
                    { label: `⛽ ${t('fuel')}`, val: fuelDisplay(m.fuel, m.fuelCapacity) },
                    { label: `⏱️ ${t('hmrToday')}`, val: formatHoursHm(m.hmr) },
                  ].map((d, j) => (
                    <div key={j} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px' }}>
                      <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 3px' }}>{d.label}</p>
                      <p style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '13px', margin: 0 }}>{d.val}</p>
                    </div>
                  ))}
                </div>
                {/* Fuel Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#8896a8', fontSize: '11px', width: '40px' }}>⛽</span>
                  <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>
                    <div style={{ height: '100%', width: `${m.fuel}%`, background: m.fuel > 30 ? '#4CAF50' : '#e94560', borderRadius: '3px' }}></div>
                  </div>
                  <span style={{ color: m.fuel > 30 ? '#4CAF50' : '#e94560', fontSize: '12px', fontWeight: '700' }}>{fuelDisplay(m.fuel, m.fuelCapacity)}</span>
                </div>

                {activeTab === 'machines' && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: gridCols(2, 2, 3),
                      gap: 8,
                      marginBottom: 12,
                    }}>
                      <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10 }}>
                        <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 3px' }}>{t('ratePerHourLabel')}</p>
                        <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: 13, margin: 0 }}>
                          {raw?.rate_per_hour != null
                            ? `₹${Number(raw.rate_per_hour).toLocaleString('en-IN')}`
                            : '—'}
                        </p>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10 }}>
                        <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 3px' }}>{t('ratePerDayLabel')}</p>
                        <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: 13, margin: 0 }}>
                          {raw?.rate_per_day != null
                            ? `₹${Number(raw.rate_per_day).toLocaleString('en-IN')}`
                            : '—'}
                        </p>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10 }}>
                        <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 3px' }}>{t('myMachinesComplianceSummary')}</p>
                        <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: 13, margin: 0 }}>
                          {(() => {
                            if (!machineUuid) return '—';
                            const c = complianceData[machineUuid];
                            if (!c) return t('loading');
                            const end = c.insurance_expiry;
                            if (!end) return t('complianceNotSet');
                            const st = complianceDateStatus(end);
                            if (st === 'expired') return t('complianceExpired');
                            if (st === 'expiring_critical') return t('complianceExpiringCritical');
                            if (st === 'expiring_soon') return t('complianceExpiringSoon');
                            if (st === 'valid') return t('complianceValid');
                            return t('complianceNotSet');
                          })()}
                        </p>
                      </div>
                    </div>
                    {machineUuid && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditRegSelectedId(machineUuid);
                          setEditingMachineId(null);
                          setEditMachineForm({});
                          setEditingFinancialMachineId(null);
                          setEditingComplianceId(null);
                          setActiveTab('edit-registration');
                        }}
                        style={{
                          background: 'rgba(201,168,76,0.15)',
                          border: '1px solid rgba(201,168,76,0.4)',
                          color: '#C9A84C',
                          borderRadius: 6,
                          padding: '8px 14px',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        {t('myMachinesEditRegistrationBtn')}
                      </button>
                    )}
                  </div>
                )}

                {activeTab === 'edit-registration' && machineUuid && (
                <>
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(233,69,96,0.06)',
                  borderRadius: 8,
                  border: '1px solid rgba(233,69,96,0.25)',
                }}>
                  <p style={{
                    color: '#e94560',
                    fontWeight: 700,
                    fontSize: 12,
                    margin: '0 0 6px',
                  }}>
                    {t('lockedRegistrationFieldsTitle')}
                  </p>
                  <p style={{
                    color: '#8896a8',
                    fontSize: 11,
                    margin: '0 0 10px',
                    lineHeight: 1.45,
                  }}>
                    {t('lockedRegistrationFieldsNote')}
                  </p>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: gridCols(2, 2, 4),
                    gap: 8,
                    marginBottom: 10,
                  }}>
                    {[
                      { label: t('surveyColName'), val: raw?.name || m.name || '—' },
                      { label: t('type'), val: raw?.type || m.type || '—' },
                      {
                        label: t('lockedFieldRegNo'),
                        val: (raw?.reg_no || m.regNo) === 'TRACKED-NO-RTO'
                          ? t('crawlerNoRto')
                          : (raw?.reg_no || m.regNo || '—'),
                      },
                      {
                        label: t('machineYearOfManufacture'),
                        val: raw?.year || m.year || '—',
                      },
                    ].map((row) => (
                      <div key={row.label} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: 8 }}>
                        <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 2px' }}>{row.label}</p>
                        <p style={{ color: '#e8e0d0', fontSize: 12, fontWeight: 600, margin: 0 }}>{row.val}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ color: '#8896a8', fontSize: 11, fontWeight: 600, margin: '0 0 6px' }}>
                    {t('lockedRegistrationDocuments')}
                  </p>
                  {(() => {
                    const matchReg = (pendingRegistrations || []).find((reg) => (
                      reg.status === 'approved'
                      && (
                        (raw?.reg_no && reg.reg_no && reg.reg_no === raw.reg_no)
                        || (raw?.name && reg.machine_name && reg.machine_name === raw.name)
                      )
                    ));
                    const docs = matchReg?.documents && typeof matchReg.documents === 'object'
                      ? matchReg.documents
                      : null;
                    const entries = docs
                      ? Object.entries(docs).filter(([, meta]) => {
                        if (!meta) return false;
                        if (typeof meta === 'string') return Boolean(meta.trim());
                        if (typeof meta === 'object') {
                          return Boolean(meta.url || meta.signedUrl || meta.path || meta.storage_path);
                        }
                        return false;
                      })
                      : [];
                    if (entries.length === 0) {
                      return (
                        <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                          {t('lockedRegistrationDocumentsNone')}
                        </p>
                      );
                    }
                    return (
                      <ul style={{ margin: 0, paddingLeft: 18, color: '#e8e0d0', fontSize: 11 }}>
                        {entries.map(([key, meta]) => {
                          const url = typeof meta === 'string'
                            ? meta
                            : (meta.url || meta.signedUrl || null);
                          const label = key.replace(/_/g, ' ');
                          return (
                            <li key={key} style={{ marginBottom: 4 }}>
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: '#C9A84C' }}
                                >
                                  {label}
                                </a>
                              ) : (
                                <span>{label} — {t('lockedRegistrationDocumentOnFile')}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
                {renderDieselSection(machineUuid, raw)}
                {renderMarketSection(machineUuid, raw)}
                {/* Recovery Plan — additive section */}
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  border: '1px solid rgba(201,168,76,0.15)',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}>
                    <p style={{
                      color: '#C9A84C',
                      fontWeight: 700,
                      fontSize: 12,
                      margin: 0,
                    }}>
                      {t('recoveryPlan')}
                    </p>
                    {!recoveryLoading[machineUuid]
                      && recoveryData[machineUuid]?.recovery_available
                      && editingFinancialMachineId !== machineUuid && (
                      <button
                        type="button"
                        onClick={() => openFinancialEdit(machineUuid, raw)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#C9A84C',
                          fontSize: 11,
                          cursor: 'pointer',
                          padding: 0,
                          fontWeight: 600,
                        }}
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                  {recoveryLoading[machineUuid] ? (
                    <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>{t('loading')}</p>
                  ) : (() => {
                    const recovery = recoveryData[machineUuid];
                    if (!recovery || recovery.recovery_available === false) {
                      return (
                        <div>
                          <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px' }}>
                            {t('recoveryAddPrice')}
                          </p>
                          {editingFinancialMachineId === machineUuid ? (
                            renderFinancialEditForm(machineUuid)
                          ) : (
                            <button
                              type="button"
                              onClick={() => openFinancialEdit(machineUuid, raw)}
                              style={{
                                background: 'rgba(201,168,76,0.1)',
                                border: '1px solid rgba(201,168,76,0.3)',
                                color: '#C9A84C',
                                borderRadius: 6,
                                padding: '5px 12px',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              {t('editFinancialDetails')}
                            </button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div>
                        {editingFinancialMachineId === machineUuid ? (
                          renderFinancialEditForm(machineUuid)
                        ) : (
                          <>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 6,
                        }}>
                          <span style={{ fontSize: 14 }}>
                            {recoveryTrafficEmoji(recovery.traffic_light)}
                          </span>
                          <span style={{
                            color: '#e8e0d0',
                            fontSize: 12,
                            fontWeight: 600,
                          }}>
                            {t(recoveryStatusI18nKey(recovery.traffic_light))}
                          </span>
                        </div>
                        <p style={{
                          color: '#8896a8',
                          fontSize: 11,
                          margin: '0 0 4px',
                        }}>
                          {t('recoveryProgress')}
                        </p>
                        <p style={{
                          color: '#e8e0d0',
                          fontFamily: 'monospace',
                          fontSize: 12,
                          margin: 0,
                          letterSpacing: '0.05em',
                        }}>
                          {recoveryProgressBar(recovery.recovery_percent)}
                        </p>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {editingMachineId === machineUuid ? (
                  <div style={{
                    marginTop: 10,
                    padding: 12,
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 8,
                    border: '1px solid rgba(201,168,76,0.2)',
                  }}>
                    <p style={{
                      color: '#C9A84C',
                      fontWeight: 700,
                      fontSize: 12,
                      margin: '0 0 8px',
                    }}>
                      {t('editMachineRatesTitle')}
                    </p>
                    {[
                      { key: 'rate_per_hour', label: t('ratePerHourLabel') },
                      { key: 'minimum_hours', label: t('minimumHoursLabel') },
                      { key: 'rate_per_day', label: t('ratePerDayLabel') },
                      { key: 'fuel_capacity_litres',
                        label: t('fuelCapacityLabel') },
                    ].map((field) => (
                      <div key={field.key} style={{
                        marginBottom: 8,
                      }}>
                        <label style={{
                          color: '#8896a8',
                          fontSize: 11,
                          display: 'block',
                          marginBottom: 3,
                        }}>
                          {field.label}
                        </label>
                        <input
                          type="number"
                          className="de-owner-input"
                          defaultValue={raw?.[field.key] || ''}
                          onChange={(e) => setEditMachineForm(
                            (prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }),
                          )}
                        />
                      </div>
                    ))}
                    <div style={{ marginBottom: 8 }}>
                      <label style={{
                        color: '#8896a8',
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 3,
                        cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            editMachineForm.is_negotiable !== undefined
                              ? editMachineForm.is_negotiable
                              : raw?.is_negotiable,
                          )}
                          onChange={(e) => setEditMachineForm((prev) => ({
                            ...prev,
                            is_negotiable: e.target.checked,
                            ...(e.target.checked
                              ? {}
                              : { minimum_rate_per_cycle: prev.minimum_rate_per_cycle }),
                          }))}
                        />
                        Rates negotiable (contract / custom)
                      </label>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{
                        color: '#8896a8',
                        fontSize: 11,
                        display: 'block',
                        marginBottom: 3,
                      }}>
                        Minimum rate per cycle (₹)
                      </label>
                      <input
                        type="number"
                        className="de-owner-input"
                        min="0"
                        value={
                          editMachineForm.minimum_rate_per_cycle !== undefined
                            ? editMachineForm.minimum_rate_per_cycle
                            : (raw?.minimum_rate_per_cycle ?? '')
                        }
                        onChange={(e) => setEditMachineForm((prev) => ({
                          ...prev,
                          minimum_rate_per_cycle: e.target.value,
                        }))}
                      />
                    </div>
                    <div style={{ marginBottom: 10, marginTop: 4 }}>
                      <p style={{
                        color: '#8896a8',
                        fontSize: 11,
                        margin: '0 0 6px',
                        fontWeight: 600,
                      }}>
                        Available Attachments (optional)
                      </p>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 6,
                      }}>
                        {ATTACHMENT_OPTIONS.map((opt) => {
                          const selected = Array.isArray(editMachineForm.attachments)
                            ? editMachineForm.attachments
                            : [];
                          return (
                            <label
                              key={opt.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                color: '#e8e0d0',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selected.includes(opt.id)}
                                onChange={(e) => {
                                  setEditMachineForm((prev) => {
                                    const current = Array.isArray(prev.attachments)
                                      ? prev.attachments
                                      : [];
                                    const nextAttachments = e.target.checked
                                      ? [...current, opt.id]
                                      : current.filter((id) => id !== opt.id);
                                    const nextRates = { ...(prev.attachment_rates || {}) };
                                    const nextMins = { ...(prev.attachment_min_hours || {}) };
                                    if (!e.target.checked) {
                                      delete nextRates[opt.id];
                                      delete nextMins[opt.id];
                                    }
                                    const nextPrimary = prev.primary_attachment
                                      && nextAttachments.includes(prev.primary_attachment)
                                      ? prev.primary_attachment
                                      : '';
                                    return {
                                      ...prev,
                                      attachments: nextAttachments,
                                      attachment_rates: nextRates,
                                      attachment_min_hours: nextMins,
                                      primary_attachment: nextPrimary,
                                    };
                                  });
                                }}
                              />
                              {opt.label}
                            </label>
                          );
                        })}
                      </div>
                      {(Array.isArray(editMachineForm.attachments)
                        ? editMachineForm.attachments
                        : []).length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{
                            color: '#8896a8',
                            fontSize: 11,
                            display: 'block',
                            marginBottom: 3,
                          }}>
                            Primary attachment (default)
                          </label>
                          <select
                            className="de-owner-input"
                            value={editMachineForm.primary_attachment || ''}
                            onChange={(e) => setEditMachineForm((prev) => ({
                              ...prev,
                              primary_attachment: e.target.value,
                            }))}
                            style={{ width: '100%' }}
                          >
                            <option value="">Select primary</option>
                            {(editMachineForm.attachments || []).map((id) => (
                              <option key={id} value={id}>
                                {ATTACHMENT_OPTIONS.find((o) => o.id === id)?.label || id}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {(Array.isArray(editMachineForm.attachments)
                        ? editMachineForm.attachments
                        : []).some((a) => ATTACHMENT_RATE_ELIGIBLE.includes(a)) && (
                        <div style={{ marginTop: 10 }}>
                          <p style={{
                            color: '#8896a8',
                            fontSize: 11,
                            margin: '0 0 4px',
                            fontWeight: 600,
                          }}>
                            Attachment Extra Rates
                          </p>
                          <p style={{
                            color: '#8896a8',
                            fontSize: 10,
                            margin: '0 0 8px',
                          }}>
                            Extra per hour when this attachment is in use (over base hourly rate)
                          </p>
                          {(editMachineForm.attachments || [])
                            .filter((a) => ATTACHMENT_RATE_ELIGIBLE.includes(a))
                            .map((attachId) => {
                              const label = ATTACHMENT_OPTIONS.find((o) => o.id === attachId)?.label
                                || attachId;
                              return (
                                <div key={attachId} style={{ marginBottom: 8 }}>
                                  <label style={{
                                    color: '#8896a8',
                                    fontSize: 11,
                                    display: 'block',
                                    marginBottom: 3,
                                  }}>
                                    {label} — extra rate (₹/hr)
                                  </label>
                                  <input
                                    type="number"
                                    className="de-owner-input"
                                    min="0"
                                    placeholder="Optional"
                                    value={
                                      (editMachineForm.attachment_rates || {})[attachId] ?? ''
                                    }
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setEditMachineForm((prev) => {
                                        const nextRates = { ...(prev.attachment_rates || {}) };
                                        const nextMins = { ...(prev.attachment_min_hours || {}) };
                                        if (nextVal === '') {
                                          delete nextRates[attachId];
                                          delete nextMins[attachId];
                                        } else {
                                          nextRates[attachId] = nextVal;
                                        }
                                        return {
                                          ...prev,
                                          attachment_rates: nextRates,
                                          attachment_min_hours: nextMins,
                                        };
                                      });
                                    }}
                                  />
                                  <label style={{
                                    color: '#8896a8',
                                    fontSize: 11,
                                    display: 'block',
                                    margin: '6px 0 3px',
                                  }}>
                                    Minimum usage hours for this attachment
                                  </label>
                                  <input
                                    type="number"
                                    className="de-owner-input"
                                    min="0"
                                    step="0.01"
                                    placeholder="Optional"
                                    value={
                                      (editMachineForm.attachment_min_hours || {})[attachId] ?? ''
                                    }
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setEditMachineForm((prev) => {
                                        const nextMins = { ...(prev.attachment_min_hours || {}) };
                                        if (nextVal === '') delete nextMins[attachId];
                                        else nextMins[attachId] = nextVal;
                                        return { ...prev, attachment_min_hours: nextMins };
                                      });
                                    }}
                                  />
                                  <p style={{
                                    color: '#8896a8',
                                    fontSize: 10,
                                    margin: '3px 0 0',
                                  }}>
                                    Shortest attachment usage you will accept when this attachment is needed. Blank = no restriction.
                                  </p>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                    <div style={{
                      display: 'flex', gap: 8, marginTop: 10,
                    }}>
                      <button
                        type="button"
                        onClick={() => handleSaveMachine(machineUuid)}
                        style={{
                          background: 'rgba(201,168,76,0.2)',
                          border: '1px solid rgba(201,168,76,0.4)',
                          color: '#C9A84C',
                          borderRadius: 6,
                          padding: '6px 16px',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMachineId(null);
                          setEditMachineForm({});
                        }}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#8896a8',
                          borderRadius: 6,
                          padding: '6px 16px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMachineId(machineUuid);
                      setEditMachineForm({
                        is_negotiable: Boolean(raw?.is_negotiable),
                        minimum_rate_per_cycle:
                          raw?.minimum_rate_per_cycle != null
                            ? String(raw.minimum_rate_per_cycle)
                            : '',
                        attachments: Array.isArray(raw?.attachments)
                          ? [...raw.attachments]
                          : [],
                        attachment_rates: (
                          raw?.attachment_rates
                          && typeof raw.attachment_rates === 'object'
                          && !Array.isArray(raw.attachment_rates)
                        )
                          ? { ...raw.attachment_rates }
                          : {},
                        attachment_min_hours: (
                          raw?.attachment_min_hours
                          && typeof raw.attachment_min_hours === 'object'
                          && !Array.isArray(raw.attachment_min_hours)
                        )
                          ? { ...raw.attachment_min_hours }
                          : {},
                        primary_attachment: raw?.primary_attachment || '',
                      });
                    }}
                    style={{
                      background: 'rgba(201,168,76,0.1)',
                      border: '1px solid rgba(201,168,76,0.3)',
                      color: '#C9A84C',
                      borderRadius: 6,
                      padding: '5px 12px',
                      fontSize: 11,
                      cursor: 'pointer',
                      marginTop: 8,
                    }}
                  >
                    {t('editRatesBtn')}
                  </button>
                )}
                <div style={{
                  marginTop: 12,
                  borderTop: '1px solid rgba(201,168,76,0.15)',
                  paddingTop: 12,
                }}>
                  {(() => {
                    const compliance = complianceData[machineUuid] || {
                      insurance_start: null,
                      insurance_expiry: null,
                      rc_start: null,
                      rc_expiry: null,
                      puc_start: null,
                      puc_expiry: null,
                    };
                    const statusLabelFor = (status) => {
                      if (status === 'expired') return t('complianceExpired');
                      if (status === 'expiring_critical') return t('complianceExpiringCritical');
                      if (status === 'expiring_soon') return t('complianceExpiringSoon');
                      if (status === 'valid') return t('complianceValid');
                      return t('complianceNotSet');
                    };
                    const fields = [
                      {
                        startKey: 'insurance_start',
                        endKey: 'insurance_expiry',
                        label: t('complianceInsurance'),
                        docType: 'insurance',
                        show: true,
                      },
                      {
                        startKey: 'rc_start',
                        endKey: 'rc_expiry',
                        label: t('complianceRcBook'),
                        docType: 'rc',
                        show: m.rtoApplicable,
                      },
                      {
                        startKey: 'puc_start',
                        endKey: 'puc_expiry',
                        label: t('compliancePuc'),
                        docType: 'puc',
                        show: m.rtoApplicable,
                      },
                    ].filter((f) => f.show);
                    const isEditingCompliance = editingComplianceId === machineUuid;
                    return (
                      <>
                        {!isEditingCompliance && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingComplianceId(machineUuid);
                                setComplianceForm({
                                  insurance_start: compliance.insurance_start || '',
                                  insurance_expiry: compliance.insurance_expiry || '',
                                  rc_start: compliance.rc_start || '',
                                  rc_expiry: compliance.rc_expiry || '',
                                  puc_start: compliance.puc_start || '',
                                  puc_expiry: compliance.puc_expiry || '',
                                });
                              }}
                              style={{
                                background: 'rgba(201,168,76,0.1)',
                                border: '1px solid rgba(201,168,76,0.3)',
                                color: '#C9A84C',
                                borderRadius: 6,
                                padding: '4px 10px',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        )}
                        {fields.map((field) => {
                          const endVal = compliance[field.endKey];
                          const status = complianceDateStatus(endVal);
                          const badge = complianceStatusBadgeStyle(status);
                          const badgeEl = (
                            <span style={{
                              ...s.statusBadge,
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              color: badge.color,
                              fontSize: 10,
                              flexShrink: 0,
                            }}>
                              {statusLabelFor(status)}
                            </span>
                          );
                          if (isEditingCompliance) {
                            const isExtracting = Boolean(complianceExtracting[field.endKey]);
                            const extractMessage = complianceExtractMessage[field.endKey];
                            const extractInputId = `compliance-extract-${machineUuid}-${field.endKey}`;
                            return (
                              <div
                                key={field.endKey}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                  marginBottom: 8,
                                }}
                              >
                                <label style={{
                                  color: '#c9a84c',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  flexShrink: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}>
                                  {field.label}
                                  <input
                                    id={extractInputId}
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      const selected = e.target.files?.[0];
                                      if (selected) {
                                        handleComplianceExtract(machineUuid, field, selected);
                                      }
                                      e.target.value = '';
                                    }}
                                  />
                                  <button
                                    type="button"
                                    title={t('complianceExtractBtn')}
                                    disabled={isExtracting}
                                    onClick={() => document.getElementById(extractInputId)?.click()}
                                    style={{
                                      background: 'rgba(255,255,255,0.05)',
                                      border: '1px solid rgba(255,255,255,0.15)',
                                      borderRadius: 4,
                                      color: '#C9A84C',
                                      padding: '2px 6px',
                                      fontSize: 11,
                                      cursor: isExtracting ? 'wait' : 'pointer',
                                      lineHeight: 1,
                                    }}
                                  >
                                    📎
                                  </button>
                                </label>
                                {isExtracting && (
                                  <span style={{ color: '#8896a8', fontSize: 10, flexShrink: 0 }}>
                                    {t('complianceExtracting')}
                                  </span>
                                )}
                                {!isExtracting && extractMessage === 'success' && (
                                  <span style={{ color: '#22c55e', fontSize: 10, flexShrink: 0 }}>
                                    {t('complianceExtractSuccess')}
                                  </span>
                                )}
                                {!isExtracting && extractMessage === 'error' && (
                                  <span style={{ color: '#ef4444', fontSize: 10, flexShrink: 0 }}>
                                    {t('complianceExtractError')}
                                  </span>
                                )}
                                <input
                                  type="date"
                                  className="de-owner-input"
                                  style={{ flex: '1 1 120px', minWidth: 120 }}
                                  value={complianceForm[field.startKey] || ''}
                                  onChange={(e) => setComplianceForm((prev) => ({
                                    ...prev,
                                    [field.startKey]: e.target.value,
                                  }))}
                                />
                                <span style={{ color: '#8896a8', flexShrink: 0 }}>→</span>
                                <input
                                  type="date"
                                  className="de-owner-input"
                                  style={{ flex: '1 1 120px', minWidth: 120 }}
                                  value={complianceForm[field.endKey] || ''}
                                  onChange={(e) => setComplianceForm((prev) => ({
                                    ...prev,
                                    [field.endKey]: e.target.value,
                                  }))}
                                />
                                {badgeEl}
                              </div>
                            );
                          }
                          const rangeLabel = formatComplianceDateRange(
                            compliance[field.startKey],
                            endVal,
                          );
                          return (
                            <div
                              key={field.endKey}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                                marginBottom: 8,
                              }}
                            >
                              <span style={{
                                color: '#c9a84c',
                                fontSize: 11,
                                fontWeight: 600,
                                flexShrink: 0,
                              }}>
                                {field.label}:
                              </span>
                              <span style={{ color: '#e8e0d0', fontSize: 12, flex: '1 1 auto' }}>
                                {rangeLabel || t('complianceNotSet')}
                              </span>
                              {badgeEl}
                            </div>
                          );
                        })}
                        {isEditingCompliance && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                              type="button"
                              disabled={complianceSaving}
                              onClick={() => handleSaveCompliance(machineUuid, m.rtoApplicable)}
                              style={{
                                background: 'rgba(201,168,76,0.2)',
                                border: '1px solid rgba(201,168,76,0.4)',
                                color: '#C9A84C',
                                borderRadius: 6,
                                padding: '6px 16px',
                                fontSize: 12,
                                cursor: complianceSaving ? 'wait' : 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              {t('complianceSaveBtn')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingComplianceId(null);
                                setComplianceForm({});
                                setComplianceExtracting({});
                                setComplianceExtractMessage({});
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#8896a8',
                                borderRadius: 6,
                                padding: '6px 16px',
                                fontSize: 12,
                                cursor: 'pointer',
                              }}
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div style={{
                  marginTop: 12,
                  borderTop: '1px solid rgba(201,168,76,0.15)',
                  paddingTop: 12,
                }}>
                  <p style={{
                    color: '#c9a84c',
                    fontWeight: 700,
                    fontSize: 12,
                    margin: '0 0 10px',
                  }}>
                    🔧 {t('serviceHistory')}
                  </p>
                  {serviceLoading[machineUuid] ? (
                    <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>{t('loading')}</p>
                  ) : (() => {
                    const logs = serviceLogs[machineUuid] || [];
                    const latest = logs[0] || null;
                    const nextDueStatus = latest?.next_service_date
                      ? serviceDueDateStatus(latest.next_service_date)
                      : 'not_set';
                    const nextDueBadge = serviceDueStatusBadgeStyle(nextDueStatus);
                    const nextDueLabel = nextDueStatus === 'overdue'
                      ? t('serviceOverdue')
                      : nextDueStatus === 'due_soon'
                        ? t('serviceDueSoon')
                        : nextDueStatus === 'ok'
                          ? t('complianceValid')
                          : null;
                    return (
                      <>
                        <p style={{ color: '#e8e0d0', fontSize: 12, margin: '0 0 8px' }}>
                          {latest
                            ? `${t('serviceLastService')}: ${formatComplianceDateLabel(latest.service_date) || latest.service_date} — ${serviceTypeLabel(latest.service_type, t)}`
                            : t('serviceNoRecords')}
                        </p>
                        {(latest?.next_service_date || latest?.next_service_hmr != null) && (
                          <div style={{ marginBottom: 10 }}>
                            {latest?.next_service_date && (
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 6,
                                flexWrap: 'wrap',
                              }}>
                                <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                                  {t('serviceNextDue')}: {formatComplianceDateLabel(latest.next_service_date) || latest.next_service_date}
                                </p>
                                {nextDueLabel && (
                                  <span style={{
                                    ...s.statusBadge,
                                    background: nextDueBadge.bg,
                                    border: `1px solid ${nextDueBadge.border}`,
                                    color: nextDueBadge.color,
                                    fontSize: 10,
                                  }}>
                                    {nextDueLabel}
                                  </span>
                                )}
                              </div>
                            )}
                            {latest?.next_service_hmr != null && (
                              <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                                {t('serviceNextHmr')} {Number(latest.next_service_hmr)} {t('hmrHrs')}
                              </p>
                            )}
                          </div>
                        )}
                        {serviceFormOpen === machineUuid ? (
                          <div style={{
                            marginTop: 8,
                            padding: 12,
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: 8,
                            border: '1px solid rgba(201,168,76,0.2)',
                          }}>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceDate')} *
                              </label>
                              <input
                                type="date"
                                className="de-owner-input"
                                value={serviceFormData.service_date}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  service_date: e.target.value,
                                }))}
                              />
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceType')} *
                              </label>
                              <select
                                className="de-owner-select"
                                value={serviceFormData.service_type}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  service_type: e.target.value,
                                }))}
                              >
                                <option value="routine">{t('serviceTypeRoutine')}</option>
                                <option value="major">{t('serviceTypeMajor')}</option>
                                <option value="breakdown">{t('serviceTypeBreakdown')}</option>
                                <option value="pdi">{t('serviceTypePdi')}</option>
                                <option value="other">{t('serviceTypeOther')}</option>
                              </select>
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceHmr')}
                              </label>
                              <input
                                type="number"
                                className="de-owner-input"
                                value={serviceFormData.hmr_at_service}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  hmr_at_service: e.target.value,
                                }))}
                              />
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceNextDate')}
                              </label>
                              <input
                                type="date"
                                className="de-owner-input"
                                value={serviceFormData.next_service_date}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  next_service_date: e.target.value,
                                }))}
                              />
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceWorkDone')}
                              </label>
                              <input
                                type="text"
                                className="de-owner-input"
                                value={serviceFormData.work_done}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  work_done: e.target.value,
                                }))}
                              />
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ color: '#8896a8', fontSize: 11, display: 'block', marginBottom: 3 }}>
                                {t('serviceNotes')}
                              </label>
                              <textarea
                                className="de-owner-input"
                                style={{ resize: 'vertical' }}
                                value={serviceFormData.notes}
                                onChange={(e) => setServiceFormData((prev) => ({
                                  ...prev,
                                  notes: e.target.value,
                                }))}
                                rows={3}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button
                                type="button"
                                disabled={serviceSaving}
                                onClick={() => handleAddServiceLog(machineUuid)}
                                style={{
                                  background: 'rgba(201,168,76,0.2)',
                                  border: '1px solid rgba(201,168,76,0.4)',
                                  color: '#C9A84C',
                                  borderRadius: 6,
                                  padding: '6px 16px',
                                  fontSize: 12,
                                  cursor: serviceSaving ? 'wait' : 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                {t('complianceSaveBtn')}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setServiceFormOpen(null);
                                  setServiceFormData({ ...EMPTY_SERVICE_FORM });
                                }}
                                style={{
                                  background: 'rgba(255,255,255,0.05)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  color: '#8896a8',
                                  borderRadius: 6,
                                  padding: '6px 16px',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                {t('cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setServiceFormOpen(machineUuid);
                              setServiceFormData({ ...EMPTY_SERVICE_FORM });
                            }}
                            style={{
                              background: 'rgba(201,168,76,0.1)',
                              border: '1px solid rgba(201,168,76,0.3)',
                              color: '#C9A84C',
                              borderRadius: 6,
                              padding: '5px 12px',
                              fontSize: 11,
                              cursor: 'pointer',
                              marginBottom: 10,
                            }}
                          >
                            + {t('serviceAddLog')}
                          </button>
                        )}
                        {logs.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            {logs.slice(0, 5).map((log) => (
                              <div
                                key={log.id}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)',
                                  gap: 6,
                                  padding: '8px 0',
                                  borderTop: '1px solid rgba(255,255,255,0.06)',
                                  fontSize: 11,
                                }}
                              >
                                <span style={{ color: '#e8e0d0' }}>
                                  {formatComplianceDateLabel(log.service_date) || log.service_date}
                                </span>
                                <span style={{ color: '#c9a84c' }}>{serviceTypeLabel(log.service_type, t)}</span>
                                <span style={{ color: '#8896a8' }}>
                                  {log.hmr_at_service != null ? `${Number(log.hmr_at_service)} ${t('hmrHrs')}` : '—'}
                                </span>
                                <span style={{ color: '#8896a8' }}>{log.work_done || '—'}</span>
                                <span style={{ color: '#8896a8' }}>{log.notes || '—'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                </>
                )}
              </div>
              );
            })}
          </div>
        )}

        {/* ═══ TAB: REGISTER MACHINE ═══ */}
        {activeTab === 'register' && (
          <div style={s.tableCard}>
            {ownerKycRegistrationBlocked ? (
              <div
                style={{
                  background: 'rgba(233,69,96,0.12)',
                  border: '1px solid rgba(233,69,96,0.35)',
                  color: '#e94560',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  fontSize: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <p style={{ margin: 0, flex: '1 1 200px' }}>{t('kycRejectedWarning')}</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('kyc')}
                  style={{
                    background: 'transparent',
                    border: '1px solid #e94560',
                    color: '#e94560',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  {t('kycGoToTab')} →
                </button>
              </div>
            ) : (
              <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <h3 style={{ ...s.tableTitle, margin: 0 }}>📝 {t('machineRegistrationTitle')}</h3>
              <span style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', padding: '4px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700 }}>
                {t('formLabel')} {REGISTRATION_FORM_VERSION}
              </span>
            </div>

            {regSuccess && (
              <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <p style={{ color: '#4CAF50', margin: 0, fontSize: '13px' }}>{String.fromCodePoint(0x2705)} {regSuccess}</p>
              </div>
            )}
            {regError && (
              <div style={{ background: 'rgba(233,69,96,0.1)', border: '1px solid rgba(233,69,96,0.4)', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <p style={{ color: '#e94560', margin: 0, fontSize: '13px' }}>{regError}</p>
              </div>
            )}

            {/* Steps */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', overflowX: 'auto' }}>
              {REG_STEP_KEYS.map((stepKey, i) => (
                <div key={stepKey} style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px', fontWeight: '700', fontSize: '13px', background: regStep > i + 1 ? '#4CAF50' : regStep === i + 1 ? '#c9a84c' : 'rgba(255,255,255,0.1)', color: regStep >= i + 1 ? '#0a1628' : '#8896a8', border: regStep === i + 1 ? '2px solid #c9a84c' : 'none' }}>
                    {regStep > i + 1 ? '✓' : i + 1}
                  </div>
                  <p style={{ color: regStep === i + 1 ? '#c9a84c' : '#8896a8', fontSize: '9px', margin: 0, whiteSpace: 'nowrap' }}>{t(stepKey)}</p>
                </div>
              ))}
            </div>

            {/* Step 1 */}
            {regStep === 1 && (
              <div>
                <h4 style={{ color: '#c9a84c', marginBottom: '15px' }}>👤 {t('ownerInfo')}</h4>
                {[
                  { label: t('fullName'), key: 'ownerName', placeholder: 'Rajesh Patil' },
                  { label: t('phone'), key: 'ownerPhone', placeholder: '+91-XXXXXXXXXX' },
                  { label: t('email'), key: 'ownerEmail', placeholder: 'email@gmail.com' },
                ].map(field => (
                  <div key={field.key} style={{ marginBottom: '12px' }}>
                    <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 5px' }}>{field.label}</p>
                    <input style={s.input} placeholder={field.placeholder} value={regData[field.key]} onChange={e => setRegData(prev => ({ ...prev, [field.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}

            {/* Step 2 — premium shadcn machine selection */}
            {regStep === 2 && (
              <MachineRegistrationStep2
                regData={regData}
                setRegData={setRegData}
                setRegDocuments={setRegDocuments}
                setRegError={setRegError}
                emptyRegDocumentsForMobility={emptyRegDocumentsForMobility}
                isMobile={isMobile}
              />
            )}

            {/* Step 3 */}
            {regStep === 3 && (
              <div>
                <h4 style={{ color: '#c9a84c', marginBottom: '15px' }}>🔧 {t('pdiTitle')}</h4>
                {!isRtoApplicable(regData.mobilityClass) && (
                  <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 12px', lineHeight: 1.5 }}>
                    {t('pdiCrawlerHint')}
                  </p>
                )}
                {getPdiChecksForMobility(regData.mobilityClass).map((item) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '15px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '14px', cursor: 'pointer' }} onClick={() => setRegData(prev => ({ ...prev, [item.key]: !prev[item.key] }))}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '4px', border: '2px solid rgba(201,168,76,0.5)', background: regData[item.key] ? '#c9a84c' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {regData[item.key] && <span style={{ color: '#0a1628', fontSize: '14px', fontWeight: '900' }}>✓</span>}
                    </div>
                    <p style={{ color: '#e8e0d0', fontSize: '13px', margin: 0 }}>{t(item.labelKey)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Step 4 */}
            {regStep === 4 && (
              <div>
                <h4 style={{ color: '#c9a84c', marginBottom: '15px' }}>📄 {t('documentUploadTitle')}</h4>
                <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 12px', lineHeight: 1.5 }}>
                  {isRtoApplicable(regData.mobilityClass)
                    ? t('regDocWheeledHint')
                    : t('regDocCrawlerHint')}
                </p>
                {getDocFieldsForMobility(regData.mobilityClass).map((doc) => {
                  const file = regDocuments[doc.key];
                  const inputId = `owner-reg-doc-${doc.key}`;
                  return (
                    <div key={doc.key} style={{ marginBottom: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ color: '#e8e0d0', fontSize: '13px', margin: '0 0 4px' }}>
                            {t(doc.labelKey)}
                            {!doc.required && <span style={{ color: '#8896a8', fontWeight: 400 }}> {t('optionalLabel')}</span>}
                          </p>
                          {file ? (
                            <p style={{ color: '#4CAF50', fontSize: '11px', margin: 0 }}>
                              {String.fromCodePoint(0x2705)} {file.name} · {formatFileSize(file.size)}
                            </p>
                          ) : (
                            <p style={{ color: '#8896a8', fontSize: '11px', margin: 0 }}>{t('noFileSelected')}</p>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            id={inputId}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              handleDocumentSelect(doc.key, e.target.files?.[0] || null);
                              e.target.value = '';
                            }}
                          />
                          <button
                            type="button"
                            style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}
                            onClick={() => document.getElementById(inputId)?.click()}
                          >
                            {file ? `🔄 ${t('replaceFile')}` : `📤 ${t('uploadFile')}`}
                          </button>
                          {file && (
                            <button
                              type="button"
                              style={{ background: 'rgba(233,69,96,0.1)', border: '1px solid rgba(233,69,96,0.3)', color: '#e94560', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}
                              onClick={() => setRegDocuments((prev) => ({ ...prev, [doc.key]: null }))}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Step 5 */}
            {regStep === 5 && (
              <div>
                <h4 style={{ color: '#c9a84c', marginBottom: '12px' }}>📋 {t('platformAgreement')}</h4>
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '14px', marginBottom: '15px', maxHeight: '200px', overflowY: 'auto' }}>
                  {AGREEMENT_TERM_KEYS.map((termKey) => (
                    <p key={termKey} style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 8px', lineHeight: '1.6' }}>• {t(termKey)}</p>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => setRegData(prev => ({ ...prev, agreed: !prev.agreed }))}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '4px', border: '2px solid rgba(201,168,76,0.5)', background: regData.agreed ? '#c9a84c' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {regData.agreed && <span style={{ color: '#0a1628', fontSize: '14px', fontWeight: '900' }}>✓</span>}
                  </div>
                  <p style={{ color: '#e8e0d0', fontSize: '13px', margin: 0 }}>{t('agreeTermsCheckbox')}</p>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="mt-5 flex gap-2.5">
              {regStep > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/15 bg-white/[0.04] text-white/80 hover:border-[#C9A84C]/40 hover:bg-white/[0.08] hover:text-white"
                  onClick={() => { setRegError(''); setRegStep((s) => s - 1); }}
                >
                  ← {t('back')}
                </Button>
              )}
              {regStep < 5 ? (
                <Button
                  type="button"
                  className={cn('flex-1 font-bold shadow-[0_4px_20px_rgba(201,168,76,0.25)]', 'bg-[#C9A84C] text-[#0D1B2A] hover:bg-[#d4b65a]')}
                  onClick={handleRegNext}
                >
                  {t('nextText')} →
                </Button>
              ) : (
                <Button
                  type="button"
                  className={cn(
                    'flex-1 font-bold shadow-[0_4px_20px_rgba(201,168,76,0.25)]',
                    'bg-[#C9A84C] text-[#0D1B2A] hover:bg-[#d4b65a]',
                    (!regData.agreed || regSubmitting) && 'opacity-50',
                  )}
                  disabled={!regData.agreed || regSubmitting}
                  onClick={handleRegSubmit}
                >
                  {regSubmitting ? t('loading') : t('regSubmitBtn')}
                </Button>
              )}
            </div>

            {pendingRegistrations.length > 0 && (
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(201,168,76,0.15)' }}>
                <h4 style={{ color: '#c9a84c', margin: '0 0 12px', fontSize: '13px' }}>📋 {t('submittedRegistrations')}</h4>
                {pendingRegistrations.map((reg) => (
                  <div key={reg.id} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', padding: '12px', marginBottom: '8px', border: '1px solid rgba(201,168,76,0.12)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ color: '#e8e0d0', fontWeight: 600, fontSize: '12px', margin: '0 0 4px' }}>
                          {reg.machine_name} · {reg.reg_no && reg.reg_no !== 'TRACKED-NO-RTO' ? reg.reg_no : t('crawlerNoRto')}
                          {reg.mobility_class === 'tracked' ? ' · 🛤️' : reg.mobility_class === 'wheeled' ? ' · 🛞' : ''}
                        </p>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>{new Date(reg.created_at).toLocaleString('en-IN')}</p>
                        {reg.status === 'rejected' && reg.admin_note ? (
                          <p style={{
                            color: '#e94560',
                            fontSize: '11px',
                            margin: '6px 0 0',
                            lineHeight: 1.4,
                          }}
                          >
                            Reason: {reg.admin_note}
                          </p>
                        ) : null}
                      </div>
                      <span style={{
                        ...s.statusBadge,
                        background: reg.status === 'approved' ? 'rgba(76,175,80,0.15)' : reg.status === 'rejected' ? 'rgba(233,69,96,0.15)' : 'rgba(255,152,0,0.15)',
                        border: `1px solid ${reg.status === 'approved' ? '#4CAF50' : reg.status === 'rejected' ? '#e94560' : '#FF9800'}`,
                        color: reg.status === 'approved' ? '#4CAF50' : reg.status === 'rejected' ? '#e94560' : '#FF9800',
                      }}>
                        {reg.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </div>
        )}

        {/* ═══ TAB: OPERATORS ═══ */}
        {activeTab === 'operators' && (
          <div style={{ padding: useMobileNav ? 16 : 32 }}>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
              flexWrap: 'wrap',
              gap: 12,
            }}>
              <h2 style={{
                color: '#C9A84C',
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <Users size={22} strokeWidth={2} aria-hidden />
                Operators
              </h2>
              <button
                type="button"
                style={s.confirmBtn}
                onClick={() => {
                  setShowAddForm((v) => !v);
                  setOpError('');
                  setOpSuccess('');
                }}
              >
                {showAddForm ? '✕ Cancel' : '+ Add Operator'}
              </button>
            </div>

            <div style={{
              border: '1px solid rgba(201,168,76,0.2)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              background: 'rgba(201,168,76,0.03)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: 12,
            }}>
              <div>
                <p style={{ ...s.label, marginBottom: 6 }}>{t('payrollExportMonth')}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    style={{ ...s.input, width: 140, marginBottom: 0 }}
                    value={payrollExportMonthNum}
                    onChange={(e) => setPayrollExportParts(payrollExportYear, Number(e.target.value))}
                  >
                    {PAYROLL_EXPORT_MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <select
                    style={{ ...s.input, width: 100, marginBottom: 0 }}
                    value={payrollExportYear}
                    onChange={(e) => setPayrollExportParts(Number(e.target.value), payrollExportMonthNum)}
                  >
                    {payrollExportYearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                style={{
                  ...s.downloadBtn,
                  padding: '10px 16px',
                  fontSize: 12,
                  opacity: payrollExportLoading ? 0.6 : 1,
                }}
                disabled={payrollExportLoading || !payrollExportMonth}
                onClick={handleExportPayrollCsv}
              >
                {payrollExportLoading ? t('loading') : t('exportPayrollCsv')}
              </button>
              {payrollExportError && (
                <p style={{ color: '#e94560', fontSize: 12, margin: 0, flexBasis: '100%' }}>
                  {payrollExportError}
                </p>
              )}
            </div>

            {opSuccess && (
              <div style={{
                border: '1px solid #4CAF50',
                borderRadius: 8,
                padding: 12,
                color: '#4CAF50',
                marginBottom: 16,
              }}>
                {String.fromCodePoint(0x2713)} {opSuccess}
              </div>
            )}
            {opError && (
              <div style={{
                border: '1px solid #e94560',
                borderRadius: 8,
                padding: 12,
                color: '#e94560',
                marginBottom: 16,
              }}>
                {opError}
              </div>
            )}

            {showAddForm && (
              <div style={{
                border: '1px solid rgba(201,168,76,0.2)',
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
                background: 'rgba(201,168,76,0.03)',
              }}>
                {opStep === 1 && (
                  <div style={{ maxWidth: 480 }}>
                    <p style={{ color: '#aaa', marginBottom: 20 }}>
                      Step 1 of 2 — Operator Details
                    </p>

                    <p style={s.label}>Full Name *</p>
                    <input
                      style={s.input}
                      placeholder={t('operatorFullNamePlaceholder')}
                      value={opData.name}
                      onChange={(e) => setOpData((p) => ({ ...p, name: e.target.value }))}
                    />

                    <p style={s.label}>Mobile Number *</p>
                    <input
                      style={s.input}
                      placeholder="10-digit mobile"
                      maxLength={10}
                      value={opData.phone}
                      onChange={(e) => setOpData((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    />

                    <p style={s.label}>Password *</p>
                    <input
                      style={s.input}
                      type="password"
                      placeholder={t('minPasswordPlaceholder')}
                      value={opData.password}
                      onChange={(e) => setOpData((p) => ({ ...p, password: e.target.value }))}
                    />

                    <p style={s.label}>
                      Years of Experience *
                    </p>
                    <input
                      type="number"
                      style={s.input}
                      placeholder="e.g. 5"
                      min="0"
                      max="50"
                      value={opData.experienceYears}
                      onChange={(e) => setOpData((p) => ({
                        ...p,
                        experienceYears: e.target.value,
                      }))}
                    />

                    <p style={s.label}>{t('monthlySalaryLabel')} *</p>
                    <input
                      type="number"
                      style={s.input}
                      placeholder={t('monthlySalaryPlaceholder')}
                      min="1"
                      step="1"
                      value={opData.monthlySalary}
                      onChange={(e) => setOpData((p) => ({
                        ...p,
                        monthlySalary: e.target.value.replace(/\D/g, '').slice(0, 7),
                      }))}
                    />
                    <p style={{ color: '#556070', fontSize: '11px', margin: '4px 0 0' }}>
                      {t('dailyPayrollHint')}
                    </p>

                    <p style={{ ...s.label, marginTop: 16 }}>
                      Machine Types (select all that apply) *
                    </p>
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 12,
                    }}
                    >
                      {[
                        'JCB', 'Excavator', 'Crane',
                        'Dozer', 'Grader', 'Roller',
                        'Tipper', 'Transit Mixer',
                      ].map((type) => (
                        <label
                          key={type}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            borderRadius: 20,
                            border: opData.experienceMachineTypes.includes(type)
                              ? '1px solid #c9a84c'
                              : '1px solid rgba(255,255,255,0.15)',
                            background: opData.experienceMachineTypes.includes(type)
                              ? 'rgba(201,168,76,0.15)'
                              : 'transparent',
                            color: opData.experienceMachineTypes.includes(type)
                              ? '#c9a84c'
                              : '#8896a8',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            style={{ display: 'none' }}
                            checked={opData.experienceMachineTypes.includes(type)}
                            onChange={(e) => {
                              setOpData((p) => ({
                                ...p,
                                experienceMachineTypes: e.target.checked
                                  ? [...p.experienceMachineTypes, type]
                                  : p.experienceMachineTypes.filter((t) => t !== type),
                              }));
                            }}
                          />
                          {type}
                        </label>
                      ))}
                    </div>

                    <p style={s.label}>Profile Photo (optional)</p>
                    <input
                      type="file"
                      id="op-photo-input"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleOpFileUpload('photo', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={s.confirmBtn}
                      onClick={() => document.getElementById('op-photo-input')?.click()}
                    >
                      {opFiles.photo ? `${String.fromCodePoint(0x2713)} ${opFiles.photo.name}` : 'Upload Photo'}
                    </button>

                    <button
                      type="button"
                      style={{ ...s.confirmBtn, marginTop: 24, width: '100%' }}
                      onClick={() => {
                        const phoneClean = opData.phone.replace(/\D/g, '');
                        if (!opData.name.trim() || opData.name.trim().length < 2) {
                          setOpError('Name required (min 2 characters)');
                          return;
                        }
                        if (phoneClean.length !== 10) {
                          setOpError('Valid 10-digit mobile required');
                          return;
                        }
                        if (opData.password.length < 8) {
                          setOpError('Password min 8 characters');
                          return;
                        }
                        if (!opData.experienceYears || Number(opData.experienceYears) < 0) {
                          setOpError('Experience years required');
                          return;
                        }
                        if (!opData.monthlySalary || Number(opData.monthlySalary) <= 0) {
                          setOpError(t('monthlySalaryRequired'));
                          return;
                        }
                        if (opData.experienceMachineTypes.length === 0) {
                          setOpError('Select at least one machine type');
                          return;
                        }
                        setOpError('');
                        setOpStep(2);
                      }}
                    >
                      Next → Documents
                    </button>
                  </div>
                )}

                {opStep === 2 && (
                  <div style={{ maxWidth: 480 }}>
                    <p style={{ color: '#aaa', marginBottom: 20 }}>
                      Step 2 of 2 — Documents
                    </p>

                    <p style={s.label}>Driving License (PDF/Image) — optional</p>
                    <input
                      type="file"
                      id="op-license-input"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleOpFileUpload('license', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={s.confirmBtn}
                      onClick={() => document.getElementById('op-license-input')?.click()}
                    >
                      {opFiles.license ? `${String.fromCodePoint(0x2713)} ${opFiles.license.name}` : 'Upload License'}
                    </button>

                    <p style={{ ...s.label, marginTop: 16 }}>
                      Aadhaar Card — Front Side *
                    </p>
                    <input
                      type="file"
                      id="op-aadhaar-front-input"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleOpFileUpload('aadhaarFront', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={s.confirmBtn}
                      onClick={() => document.getElementById('op-aadhaar-front-input')?.click()}
                    >
                      {opFiles.aadhaarFront
                        ? `${String.fromCodePoint(0x2713)} ${opFiles.aadhaarFront.name}`
                        : 'Upload Aadhaar Front'}
                    </button>

                    <p style={{ ...s.label, marginTop: 16 }}>
                      Aadhaar Card — Back Side *
                    </p>
                    <input
                      type="file"
                      id="op-aadhaar-back-input"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleOpFileUpload('aadhaarBack', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={s.confirmBtn}
                      onClick={() => document.getElementById('op-aadhaar-back-input')?.click()}
                    >
                      {opFiles.aadhaarBack
                        ? `${String.fromCodePoint(0x2713)} ${opFiles.aadhaarBack.name}`
                        : 'Upload Aadhaar Back'}
                    </button>

                    <p style={{ ...s.label, marginTop: 16 }}>
                      Police Verification Certificate (PDF/Image) — optional
                    </p>
                    <input
                      type="file"
                      id="op-police-input"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleOpFileUpload('police', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={s.confirmBtn}
                      onClick={() => document.getElementById('op-police-input')?.click()}
                    >
                      {opFiles.police
                        ? `${String.fromCodePoint(0x2713)} ${opFiles.police.name}`
                        : 'Upload Police Verification'}
                    </button>

                    <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                      <button
                        type="button"
                        style={s.cancelBtn}
                        onClick={() => {
                          setOpStep(1);
                          setOpError('');
                        }}
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        style={s.confirmBtn}
                        onClick={handleOpSubmit}
                        disabled={opSubmitting}
                      >
                        {opSubmitting ? 'Creating...' : 'Create Operator'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {opListLoading ? (
              <p style={{ color: '#8896a8' }}>{t('loading')}</p>
            ) : operatorList.length === 0 ? (
              <p style={{ color: '#8896a8' }}>
                No operators yet. Add your first operator.
              </p>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}>
                {operatorList.map((op) => {
                  const selectedPayrollMonth = getPayrollMonthForOperator(op.id);
                  const payrollKey = payrollMonthKey(op.id, selectedPayrollMonth);
                  const payrollPreviewData = payrollPreviewByKey[payrollKey];
                  const payrollPreviewIsLoading = payrollPreviewLoading[payrollKey];
                  const payrollPreviewErr = payrollPreviewError[payrollKey];
                  const payrollIsRunning = payrollRunning[payrollKey];
                  const payrollAlreadyDone = payrollRunCompleted[payrollKey];
                  const payrollCurrentMonth = getCurrentPayrollMonthStr();
                  const payrollPrevMonth = getPreviousPayrollMonthStr(payrollCurrentMonth);
                  const payrollHistoryRows = payrollHistoryByOperator[op.id] || [];
                  const payrollHistoryIsLoading = payrollHistoryLoading[op.id];
                  const payrollHistoryErr = payrollHistoryError[op.id];
                  const attendanceSummary = payrollPreviewData?.attendance_summary || {};
                  const selectedAttendanceMonth = getAttendanceMonthForOperator(op.id);
                  const attendanceKey = payrollMonthKey(op.id, selectedAttendanceMonth);
                  const attendanceData = attendanceByKey[attendanceKey];
                  const attendanceIsLoading = attendanceLoading[attendanceKey];
                  const attendanceErr = attendanceError[attendanceKey];
                  const attendanceRows = attendanceData?.attendance || [];
                  const attendanceMonthSummary = summarizeOwnerAttendanceRows(attendanceRows);
                  const attendanceCurrentMonth = getCurrentPayrollMonthStr();
                  const attendancePrevMonth = getPreviousPayrollMonthStr(attendanceCurrentMonth);
                  const operatorMonthlySalary = Number(op.monthly_salary);
                  const operatorHasSalary = Number.isFinite(operatorMonthlySalary) && operatorMonthlySalary > 0;
                  const operatorDailyRate = operatorHasSalary
                    ? Math.round(operatorMonthlySalary / 26)
                    : null;
                  const plQuotaData = plQuotaByOperator[op.id];
                  const plQuotaIsLoading = plQuotaLoading[op.id];
                  const plQuotaErr = plQuotaError[op.id];

                  return (
                  <div
                    key={op.id}
                    style={{
                      border: '1px solid rgba(201,168,76,0.2)',
                      borderRadius: 10,
                      padding: 16,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}>
                    <div>
                      <p style={{
                        color: '#e8e0d0',
                        fontWeight: 700,
                        margin: '0 0 4px',
                      }}>
                        {op.name}
                      </p>
                      <p style={{
                        color: '#8896a8',
                        fontSize: 12,
                        margin: '0 0 4px',
                      }}>
                        {op.phone}
                      </p>
                      <div style={{ margin: '6px 0 0' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                        >
                          <p style={{
                            color: '#c9a84c',
                            fontSize: 11,
                            margin: 0,
                            fontWeight: 600,
                          }}
                          >
                            {t('monthlySalaryLabel')}:{' '}
                            {operatorHasSalary
                              ? `₹${operatorMonthlySalary.toLocaleString('en-IN')}${t('perMonthSuffix')}`
                              : t('complianceNotSet')}
                            {' | '}
                            {operatorHasSalary
                              ? `₹${operatorDailyRate.toLocaleString('en-IN')}${t('perDaySuffix')}`
                              : '—'}
                          </p>
                          <button
                            type="button"
                            style={{
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: '1px solid rgba(201,168,76,0.35)',
                              background: salaryEditOperatorId === op.id
                                ? 'rgba(201,168,76,0.2)'
                                : 'transparent',
                              color: '#c9a84c',
                            }}
                            onClick={() => handleOpenSalaryEdit(op.id, op.monthly_salary)}
                          >
                            ✏️ {t('ownerSalaryEditBtn')}
                          </button>
                        </div>
                        {!operatorHasSalary && (
                          <p style={{ color: '#ff9800', fontSize: 10, margin: '4px 0 0' }}>
                            {t('ownerSalaryNotSet')}
                          </p>
                        )}
                        {salaryUpdateSuccess[op.id] && (
                          <p style={{ color: '#4caf50', fontSize: 10, margin: '4px 0 0' }}>
                            {salaryUpdateSuccess[op.id]}
                          </p>
                        )}
                        {salaryEditOperatorId === op.id && (
                          <div style={{
                            marginTop: 8,
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid rgba(201,168,76,0.25)',
                            background: 'rgba(201,168,76,0.05)',
                          }}
                          >
                            {salaryEditError && (
                              <p style={{ color: '#e94560', fontSize: 11, margin: '0 0 8px' }}>
                                {salaryEditError}
                              </p>
                            )}
                            <p style={{ ...s.label, marginBottom: 4, fontSize: 11 }}>
                              {t('monthlySalaryLabel')}
                            </p>
                            <div style={{
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                            >
                              <input
                                type="number"
                                style={{ ...s.input, fontSize: 12, padding: '6px 10px', width: 120 }}
                                placeholder={t('monthlySalaryPlaceholder')}
                                min="1"
                                value={salaryEditAmount}
                                onChange={(e) => setSalaryEditAmount(
                                  e.target.value.replace(/\D/g, '').slice(0, 7),
                                )}
                              />
                              <span style={{ color: '#8896a8', fontSize: 12 }}>₹</span>
                              <button
                                type="button"
                                style={{ ...s.confirmBtn, fontSize: 11, padding: '6px 12px' }}
                                disabled={salaryEditSubmitting}
                                onClick={() => handleSaveOperatorSalary(op.id)}
                              >
                                {salaryEditSubmitting ? t('saving') : t('ownerAttendanceSave')}
                              </button>
                              <button
                                type="button"
                                style={{ ...s.cancelBtn, fontSize: 11, padding: '6px 12px' }}
                                disabled={salaryEditSubmitting}
                                onClick={handleCancelSalaryEdit}
                              >
                                {t('cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <p style={{
                        color: Number(op.advance_balance) > 0 ? '#ff9800' : '#8896a8',
                        fontSize: 11,
                        margin: '4px 0 0',
                        fontWeight: Number(op.advance_balance) > 0 ? 600 : 400,
                      }}
                      >
                        {t('advanceBalance')}: ₹{Number(op.advance_balance || 0).toLocaleString('en-IN')}
                      </p>
                      {Number(op.advance_balance) > 0 && (
                        <p style={{
                          color: '#8896a8',
                          fontSize: 10,
                          margin: '2px 0 0',
                          lineHeight: 1.4,
                        }}
                        >
                          Recoverable from next salary payment
                        </p>
                      )}
                      <span style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 20,
                        background: op.status === 'active'
                          ? 'rgba(76,175,80,0.15)'
                          : 'rgba(255,152,0,0.15)',
                        color: op.status === 'active'
                          ? '#4caf50'
                          : '#ff9800',
                      }}>
                        {op.status === 'active'
                          ? '✓ Active'
                          : '⏳ Pending Approval'}
                      </span>
                      {op.experience_years > 0 && (
                        <p style={{
                          color: '#8896a8',
                          fontSize: 11,
                          margin: '4px 0 0',
                        }}
                        >
                          {op.experience_years} yr exp
                          {op.experience_machine_types?.length > 0
                            ? ` · ${op.experience_machine_types.slice(0, 2).join(', ')}${op.experience_machine_types.length > 2 ? ` +${op.experience_machine_types.length - 2}` : ''}`
                            : ''}
                        </p>
                      )}
                      {op.created_at && (
                        <p style={{
                          color: '#556070',
                          fontSize: 11,
                          margin: '2px 0 0',
                        }}
                        >
                          {getDaysWithUs(op.created_at)} days with DE
                        </p>
                      )}
                      {(() => {
                        const star = getOperatorStar(op);
                        return star.label !== 'New' ? (
                          <p style={{
                            color: star.color,
                            fontSize: 11,
                            margin: '2px 0 0',
                            fontWeight: 600,
                          }}
                          >
                            {star.stars} {star.label}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12, flexShrink: 0, minWidth: 140 }}>
                      {assignError && assigningOperatorId === op.id && (
                        <p style={{ color: '#e94560', fontSize: 11, margin: '0 0 4px' }}>
                          {assignError}
                        </p>
                      )}

                      {op.assignedMachine ? (
                        <div>
                          <p style={{ color: '#4caf50', margin: '0 0 6px' }}>
                            ✓ {op.assignedMachine.name}
                          </p>
                          {op.status === 'active' && (
                            <button
                              type="button"
                              style={{ ...s.cancelBtn, fontSize: 11, padding: '3px 10px' }}
                              onClick={() => handleUnassignMachine(op.assignedMachine.id)}
                            >
                              Unassign
                            </button>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p style={{ color: '#8896a8', margin: '0 0 6px' }}>
                            No machine assigned
                          </p>
                          {op.status === 'active' && (
                            assigningOperatorId === op.id ? (
                              <div>
                                <select
                                  style={{ ...s.input, fontSize: 12, padding: '4px 8px', marginBottom: 6 }}
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAssignMachine(op.id, e.target.value);
                                    }
                                  }}
                                >
                                  <option value="" disabled>
                                    Select machine...
                                  </option>
                                  {machineData
                                    .filter((m) => !m.operator_id && m.owner_id === (sessionUser.id || sessionUser.user_id))
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name} ({m.machine_id})
                                      </option>
                                    ))}
                                </select>
                                <button
                                  type="button"
                                  style={{ ...s.cancelBtn, fontSize: 11, padding: '3px 10px' }}
                                  onClick={() => {
                                    setAssigningOperatorId(null);
                                    setAssignError('');
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                style={{ ...s.confirmBtn, fontSize: 11, padding: '4px 12px' }}
                                onClick={() => {
                                  setAssigningOperatorId(op.id);
                                  setAssignError('');
                                }}
                              >
                                Assign Machine
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                    </div>

                    {op.status === 'active' && (
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid rgba(201,168,76,0.15)',
                      }}
                      >
                        <button
                          type="button"
                          style={{
                            ...operatorCardActionBtn(
                              payrollPanelOperatorId === op.id,
                              '#4caf50',
                            ),
                            ...(!operatorHasSalary ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                          }}
                          disabled={!operatorHasSalary}
                          title={!operatorHasSalary ? t('ownerSalaryNotSet') : undefined}
                          onClick={() => handleOpenPayrollPanel(op.id)}
                        >
                          {t('payrollPreview')}
                        </button>
                        <button
                          type="button"
                          style={operatorCardActionBtn(
                            advancePanelOperatorId === op.id,
                            '#e94560',
                          )}
                          onClick={() => handleOpenAdvancePanel(op.id)}
                        >
                          {advancePanelOperatorId === op.id ? t('closeAdvance') : t('giveAdvance')}
                        </button>
                        <button
                          type="button"
                          style={operatorCardActionBtn(
                            attendancePanelOperatorId === op.id,
                            '#2196f3',
                          )}
                          onClick={() => handleOpenAttendancePanel(op.id)}
                        >
                          {t('ownerAttendanceTitle')}
                        </button>
                      </div>
                    )}

                    {advancePanelOperatorId === op.id && (
                      <div style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: '1px solid rgba(201,168,76,0.15)',
                      }}
                      >
                        {advanceError && (
                          <p style={{ color: '#e94560', fontSize: 12, margin: '0 0 8px' }}>
                            {advanceError}
                          </p>
                        )}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: useMobileNav ? '1fr' : '1fr 1fr 1fr auto',
                          gap: 10,
                          alignItems: 'end',
                          marginBottom: 16,
                        }}
                        >
                          <div>
                            <p style={{ ...s.label, marginBottom: 4 }}>{t('amountLabel')} *</p>
                            <input
                              type="number"
                              style={s.input}
                              placeholder={t('amountPlaceholder')}
                              min="1"
                              value={advanceForm.amount}
                              onChange={(e) => setAdvanceForm((p) => ({
                                ...p,
                                amount: e.target.value.replace(/\D/g, '').slice(0, 7),
                              }))}
                            />
                          </div>
                          <div>
                            <p style={{ ...s.label, marginBottom: 4 }}>{t('noteOptional')}</p>
                            <input
                              style={s.input}
                              placeholder={t('advanceNotePlaceholder')}
                              maxLength={500}
                              value={advanceForm.note}
                              onChange={(e) => setAdvanceForm((p) => ({ ...p, note: e.target.value }))}
                            />
                          </div>
                          <div style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: 'rgba(201,168,76,0.08)',
                            border: '1px solid rgba(201,168,76,0.2)',
                          }}
                          >
                            <p style={{ color: '#8896a8', fontSize: 10, margin: '0 0 2px' }}>{t('outstandingBalance')}</p>
                            <p style={{ color: '#c9a84c', fontWeight: 700, margin: 0, fontSize: 14 }}>
                              ₹{Number(
                                advanceLedger[op.id]?.advance_balance ?? op.advance_balance ?? 0,
                              ).toLocaleString('en-IN')}
                            </p>
                          </div>
                          <button
                            type="button"
                            style={{ ...s.confirmBtn, padding: '10px 16px' }}
                            disabled={advanceSubmitting}
                            onClick={() => handleGiveAdvance(op.id)}
                          >
                            {advanceSubmitting ? t('saving') : t('recordAdvance')}
                          </button>
                        </div>

                        <p style={{ color: '#8896a8', fontSize: 11, margin: '0 0 8px', fontWeight: 600 }}>
                          {t('recentTransactions')}
                        </p>
                        {advanceLedgerLoading[op.id] ? (
                          <p style={{ color: '#8896a8', fontSize: 12 }}>{t('loading')}</p>
                        ) : (advanceLedger[op.id]?.advances || []).length === 0 ? (
                          <p style={{ color: '#556070', fontSize: 12 }}>{t('noAdvancesYet')}</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(advanceLedger[op.id]?.advances || []).slice(0, 10).map((txn) => (
                              <div
                                key={txn.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                  padding: '8px 10px',
                                  borderRadius: 6,
                                  background: 'rgba(0,0,0,0.2)',
                                  fontSize: 11,
                                }}
                              >
                                <div>
                                  <span style={{
                                    color: txn.txn_type === 'advance' ? '#ff9800' : '#4caf50',
                                    fontWeight: 600,
                                  }}
                                  >
                                    {txn.txn_type === 'advance' ? t('advanceTxnLabel') : t('deductionTxnLabel')}
                                  </span>
                                  {txn.note && (
                                    <span style={{ color: '#8896a8', marginLeft: 8 }}>{txn.note}</span>
                                  )}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ color: '#e8e0d0', fontWeight: 600 }}>
                                    ₹{Number(txn.amount).toLocaleString('en-IN')}
                                  </span>
                                  <span style={{ color: '#556070', marginLeft: 8 }}>
                                    {new Date(txn.created_at).toLocaleDateString('en-IN')}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {payrollPanelOperatorId === op.id && (
                      <div style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: '1px solid rgba(76,175,80,0.2)',
                      }}
                      >
                        <p style={{ color: '#c9a84c', fontSize: 12, fontWeight: 600, margin: '0 0 10px' }}>
                          {t('payrollPreview')}
                        </p>

                        {!operatorHasSalary && (
                          <p style={{
                            color: '#ff9800',
                            fontSize: 12,
                            margin: '0 0 10px',
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(255,152,0,0.1)',
                            border: '1px solid rgba(255,152,0,0.35)',
                          }}
                          >
                            {t('ownerSalaryNotSet')}
                          </p>
                        )}

                        <p style={{ ...s.label, marginBottom: 6 }}>{t('payrollMonth')}</p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                          <button
                            type="button"
                            style={{
                              ...s.cancelBtn,
                              fontSize: 11,
                              padding: '6px 12px',
                              borderColor: selectedPayrollMonth === payrollPrevMonth ? '#4caf50' : undefined,
                              color: selectedPayrollMonth === payrollPrevMonth ? '#4caf50' : undefined,
                            }}
                            onClick={() => handlePayrollMonthChange(op.id, payrollPrevMonth)}
                          >
                            {payrollPrevMonth}
                          </button>
                          <button
                            type="button"
                            style={{
                              ...s.cancelBtn,
                              fontSize: 11,
                              padding: '6px 12px',
                              borderColor: selectedPayrollMonth === payrollCurrentMonth ? '#4caf50' : undefined,
                              color: selectedPayrollMonth === payrollCurrentMonth ? '#4caf50' : undefined,
                            }}
                            onClick={() => handlePayrollMonthChange(op.id, payrollCurrentMonth)}
                          >
                            {payrollCurrentMonth}
                          </button>
                        </div>

                        {payrollPreviewIsLoading && (
                          <p style={{ color: '#8896a8', fontSize: 12 }}>{t('loading')}</p>
                        )}
                        {payrollPreviewErr && (
                          <p style={{ color: '#e94560', fontSize: 12, margin: '0 0 8px' }}>{payrollPreviewErr}</p>
                        )}
                        {payrollRunError[op.id] && (
                          <p style={{ color: '#e94560', fontSize: 12, margin: '0 0 8px' }}>{payrollRunError[op.id]}</p>
                        )}
                        {payrollRunSuccess[op.id] && (
                          <p style={{ color: '#4caf50', fontSize: 12, margin: '0 0 8px' }}>{payrollRunSuccess[op.id]}</p>
                        )}

                        {payrollPreviewData && !payrollPreviewIsLoading && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: useMobileNav ? '1fr' : '1fr 1fr',
                            gap: 10,
                            marginBottom: 14,
                            fontSize: 12,
                          }}
                          >
                            <p style={{ color: '#8896a8', margin: 0 }}>
                              {t('monthlySalaryLabel')}:{' '}
                              <strong style={{ color: '#e8e0d0' }}>
                                ₹{Number(payrollPreviewData.monthly_salary || 0).toLocaleString('en-IN')}
                              </strong>
                            </p>
                            <p style={{ color: '#8896a8', margin: 0 }}>
                              {t('payrollDailyRate')}:{' '}
                              <strong style={{ color: '#e8e0d0' }}>
                                ₹{Number(payrollPreviewData.daily_rate || 0).toLocaleString('en-IN')}
                              </strong>
                            </p>
                            <p style={{ color: '#8896a8', margin: 0, gridColumn: useMobileNav ? 'auto' : '1 / -1' }}>
                              {t('attendanceStatusSection')}:{' '}
                              {t('presentLabel')}: {attendanceSummary.present ?? 0}
                              {' | '}
                              {t('halfDayLabel')}: {attendanceSummary.halfday ?? 0}
                              {' | '}
                              {t('paidLeaveLabel')}: {attendanceSummary.paid_leave ?? 0}
                              {' | '}
                              {t('unpaidLeaveLabel')}: {attendanceSummary.unpaid_leave ?? 0}
                              {' | '}
                              {t('absentLabel')}: {attendanceSummary.absent ?? 0}
                            </p>
                            <p style={{ color: '#8896a8', margin: 0 }}>
                              {t('payrollGross')}:{' '}
                              <strong style={{ color: '#c9a84c' }}>
                                ₹{Number(payrollPreviewData.gross_payable || 0).toLocaleString('en-IN')}
                              </strong>
                            </p>
                            <p style={{ color: '#8896a8', margin: 0 }}>
                              {t('advanceBalance')}:{' '}
                              <strong style={{ color: '#ff9800' }}>
                                ₹{Number(payrollPreviewData.advance_balance || 0).toLocaleString('en-IN')}
                              </strong>
                            </p>
                            <p style={{
                              color: '#8896a8',
                              margin: 0,
                              gridColumn: useMobileNav ? 'auto' : '1 / -1',
                              padding: '10px 12px',
                              borderRadius: 8,
                              background: 'rgba(76,175,80,0.1)',
                              border: '1px solid rgba(76,175,80,0.35)',
                            }}
                            >
                              {t('payrollNet')}:{' '}
                              <strong style={{ color: '#4caf50', fontSize: 14 }}>
                                ₹{Number(payrollPreviewData.net_payable || 0).toLocaleString('en-IN')}
                              </strong>
                            </p>
                          </div>
                        )}

                        <button
                          type="button"
                          style={{
                            ...s.confirmBtn,
                            fontSize: 12,
                            padding: '8px 16px',
                            opacity: (payrollIsRunning || payrollAlreadyDone || payrollPreviewIsLoading || !operatorHasSalary) ? 0.6 : 1,
                          }}
                          disabled={
                            !operatorHasSalary
                            || payrollIsRunning
                            || payrollAlreadyDone
                            || payrollPreviewIsLoading
                            || !payrollPreviewData
                            || Number(payrollPreviewData?.gross_payable || 0) <= 0
                          }
                          onClick={() => handleRunPayroll(op.id)}
                        >
                          {payrollIsRunning
                            ? t('loading')
                            : payrollAlreadyDone
                              ? t('payrollAlreadyRun')
                              : `${t('payrollRun')} — ${selectedPayrollMonth}`}
                        </button>

                        <div style={{ marginTop: 16 }}>
                          <p style={{ color: '#c9a84c', fontSize: 12, fontWeight: 600, margin: '0 0 10px' }}>
                            {t('payrollHistory')}
                          </p>
                          {payrollHistoryIsLoading && (
                            <p style={{ color: '#8896a8', fontSize: 12, margin: 0 }}>{t('loading')}</p>
                          )}
                          {payrollHistoryErr && (
                            <p style={{ color: '#e94560', fontSize: 12, margin: '0 0 8px' }}>{payrollHistoryErr}</p>
                          )}
                          {!payrollHistoryIsLoading && !payrollHistoryErr && payrollHistoryRows.length === 0 && (
                            <p style={{ color: '#8896a8', fontSize: 12, margin: 0 }}>{t('payrollNoHistory')}</p>
                          )}
                          {!payrollHistoryIsLoading && payrollHistoryRows.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480, fontSize: 11 }}>
                                <thead>
                                  <tr>
                                    {[
                                      t('payrollColMonth'),
                                      t('payrollColGross'),
                                      t('payrollColDeduction'),
                                      t('payrollColNet'),
                                      t('payrollColDate'),
                                    ].map((h) => (
                                      <th
                                        key={h}
                                        style={{
                                          textAlign: 'left',
                                          padding: '8px 6px',
                                          color: '#8896a8',
                                          borderBottom: '1px solid rgba(201,168,76,0.15)',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {payrollHistoryRows.map((row) => (
                                    <tr key={row.id}>
                                      <td style={{ padding: '8px 6px', color: '#e8e0d0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        {row.month || '—'}
                                      </td>
                                      <td style={{ padding: '8px 6px', color: '#c9a84c', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        ₹{Number(row.gross_payable || 0).toLocaleString('en-IN')}
                                      </td>
                                      <td style={{ padding: '8px 6px', color: '#ff9800', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        ₹{Number(row.advance_deducted || 0).toLocaleString('en-IN')}
                                      </td>
                                      <td style={{ padding: '8px 6px', color: '#4caf50', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        ₹{Number(row.net_pay || 0).toLocaleString('en-IN')}
                                      </td>
                                      <td style={{ padding: '8px 6px', color: '#8896a8', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        {row.created_at
                                          ? new Date(row.created_at).toLocaleDateString('en-IN', {
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric',
                                          })
                                          : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {attendancePanelOperatorId === op.id && (
                      <div style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: '1px solid rgba(33,150,243,0.25)',
                      }}
                      >
                        <p style={{ color: '#2196f3', fontSize: 12, fontWeight: 600, margin: '0 0 10px' }}>
                          {t('ownerAttendanceTitle')}
                        </p>

                        <div style={{ marginBottom: 14 }}>
                          <p style={{ color: '#8896a8', fontSize: 10, fontWeight: 600, margin: '0 0 6px' }}>
                            {t('plQuotaLabel')}
                          </p>
                          {plQuotaIsLoading && (
                            <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>{t('loading')}</p>
                          )}
                          {plQuotaErr && (
                            <p style={{ color: '#e94560', fontSize: 11, margin: '0 0 6px' }}>{plQuotaErr}</p>
                          )}
                          {plQuotaData && !plQuotaIsLoading && (
                            <div>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                              >
                                <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                                  {t('paidLeaveLabel')}: {plQuotaData.pl_used} {t('plUsed')} / {plQuotaData.annual_pl_quota} {t('plAllowed')} ({plQuotaData.pl_remaining} {t('plRemaining')})
                                </p>
                                <button
                                  type="button"
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid rgba(33,150,243,0.35)',
                                    background: plQuotaEditOperatorId === op.id
                                      ? 'rgba(33,150,243,0.2)'
                                      : 'transparent',
                                    color: '#2196f3',
                                  }}
                                  onClick={() => handleOpenPlQuotaEdit(op.id, plQuotaData.annual_pl_quota)}
                                >
                                  ✏️
                                </button>
                              </div>
                              {plQuotaUpdateSuccess[op.id] && (
                                <p style={{ color: '#4caf50', fontSize: 10, margin: '4px 0 0' }}>
                                  {plQuotaUpdateSuccess[op.id]}
                                </p>
                              )}
                              {plQuotaEditOperatorId === op.id && (
                                <div style={{
                                  marginTop: 8,
                                  padding: '10px 12px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(33,150,243,0.25)',
                                  background: 'rgba(33,150,243,0.05)',
                                }}
                                >
                                  {plQuotaEditError && (
                                    <p style={{ color: '#e94560', fontSize: 11, margin: '0 0 8px' }}>
                                      {plQuotaEditError}
                                    </p>
                                  )}
                                  <p style={{ ...s.label, marginBottom: 4, fontSize: 11 }}>
                                    {t('plQuotaLabel')}
                                  </p>
                                  <div style={{
                                    display: 'flex',
                                    gap: 8,
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                  }}
                                  >
                                    <input
                                      type="number"
                                      style={{ ...s.input, fontSize: 12, padding: '6px 10px', width: 80 }}
                                      min="0"
                                      value={plQuotaEditAmount}
                                      onChange={(e) => setPlQuotaEditAmount(
                                        e.target.value.replace(/\D/g, '').slice(0, 3),
                                      )}
                                    />
                                    <button
                                      type="button"
                                      style={{ ...s.confirmBtn, fontSize: 11, padding: '6px 12px' }}
                                      disabled={plQuotaEditSubmitting}
                                      onClick={() => handleSavePlQuota(op.id)}
                                    >
                                      {plQuotaEditSubmitting ? t('saving') : t('ownerAttendanceSave')}
                                    </button>
                                    <button
                                      type="button"
                                      style={{ ...s.cancelBtn, fontSize: 11, padding: '6px 12px' }}
                                      disabled={plQuotaEditSubmitting}
                                      onClick={handleCancelPlQuotaEdit}
                                    >
                                      {t('cancel')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                          <button
                            type="button"
                            style={{
                              ...s.cancelBtn,
                              fontSize: 11,
                              padding: '6px 12px',
                              borderColor: selectedAttendanceMonth === attendancePrevMonth ? '#2196f3' : undefined,
                              color: selectedAttendanceMonth === attendancePrevMonth ? '#2196f3' : undefined,
                            }}
                            onClick={() => handleAttendanceMonthChange(op.id, attendancePrevMonth)}
                          >
                            {attendancePrevMonth}
                          </button>
                          <button
                            type="button"
                            style={{
                              ...s.cancelBtn,
                              fontSize: 11,
                              padding: '6px 12px',
                              borderColor: selectedAttendanceMonth === attendanceCurrentMonth ? '#2196f3' : undefined,
                              color: selectedAttendanceMonth === attendanceCurrentMonth ? '#2196f3' : undefined,
                            }}
                            onClick={() => handleAttendanceMonthChange(op.id, attendanceCurrentMonth)}
                          >
                            {attendanceCurrentMonth}
                          </button>
                        </div>

                        {attendanceIsLoading && (
                          <p style={{ color: '#8896a8', fontSize: 12 }}>{t('loading')}</p>
                        )}
                        {attendanceErr && (
                          <p style={{ color: '#e94560', fontSize: 12, margin: '0 0 8px' }}>{attendanceErr}</p>
                        )}
                        {attendanceSaveSuccess[op.id] && (
                          <p style={{ color: '#4caf50', fontSize: 12, margin: '0 0 8px' }}>
                            {attendanceSaveSuccess[op.id]}
                          </p>
                        )}

                        {!attendanceIsLoading && !attendanceErr && attendanceRows.length === 0 && (
                          <p style={{ color: '#8896a8', fontSize: 12, margin: '0 0 8px' }}>
                            {t('ownerAttendanceNoRecords')}
                          </p>
                        )}

                        {!attendanceIsLoading && attendanceRows.length > 0 && (
                          <>
                            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520, fontSize: 11 }}>
                                <thead>
                                  <tr>
                                    {[t('date'), t('status'), t('clockInLabel'), t('clockOutLabel'), t('hmrCol'), t('ownerAttendanceEdit')].map((h) => (
                                      <th
                                        key={h}
                                        style={{
                                          textAlign: 'left',
                                          padding: '8px 6px',
                                          color: '#8896a8',
                                          borderBottom: '1px solid rgba(201,168,76,0.15)',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {attendanceRows.map((row) => {
                                    const dateKey = String(row.date || '').slice(0, 10);
                                    const statusKey = String(row.status || 'absent').toLowerCase();
                                    const draftStatus = attendanceEditDraft[op.id]?.[dateKey] ?? statusKey;
                                    const rowSaveKey = `${op.id}:${dateKey}`;
                                    const isSavingRow = attendanceSavingKey === rowSaveKey;
                                    const statusChanged = draftStatus !== statusKey;
                                    return (
                                      <tr key={row.id || dateKey}>
                                        <td style={{ padding: '8px 6px', color: '#e8e0d0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                          {dateKey
                                            ? new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-IN', {
                                              day: '2-digit',
                                              month: 'short',
                                              year: 'numeric',
                                            })
                                            : '—'}
                                        </td>
                                        <td style={{ padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                          <span style={{
                                            display: 'inline-block',
                                            padding: '2px 8px',
                                            borderRadius: 12,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color: ownerAttendanceStatusColor(statusKey),
                                            background: `${ownerAttendanceStatusColor(statusKey)}18`,
                                            border: `1px solid ${ownerAttendanceStatusColor(statusKey)}33`,
                                          }}
                                          >
                                            {formatOwnerAttendanceStatus(statusKey, t)}
                                          </span>
                                        </td>
                                        <td style={{ padding: '8px 6px', color: '#8896a8', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <span>
                                              {row.check_in ? `${formatTimeHHMM(row.check_in)} IST` : '—'}
                                              {row.owner_proposed_check_in
                                                && !row.operator_correction_confirmed
                                                && !row.correction_rejected
                                                ? (
                                                  <span style={{ color: '#c9a84c', marginLeft: 6 }}>
                                                    → {formatTimeHHMM(row.owner_proposed_check_in)} (pending)
                                                  </span>
                                                )
                                                : null}
                                            </span>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                              <input
                                                type="time"
                                                step="1"
                                                style={{ ...s.input, fontSize: 11, padding: '4px 8px', width: 120 }}
                                                value={
                                                  attendanceProposeDraft[op.id]?.[dateKey]
                                                  ?? (row.check_in ? String(row.check_in).slice(0, 8) : '')
                                                }
                                                onChange={(e) => {
                                                  setAttendanceProposeDraft((prev) => ({
                                                    ...prev,
                                                    [op.id]: {
                                                      ...(prev[op.id] || {}),
                                                      [dateKey]: e.target.value,
                                                    },
                                                  }));
                                                }}
                                              />
                                              <button
                                                type="button"
                                                style={{ ...s.confirmBtn, fontSize: 10, padding: '4px 10px' }}
                                                disabled={
                                                  attendanceProposeSavingKey === `${op.id}:${dateKey}`
                                                  || !(attendanceProposeDraft[op.id]?.[dateKey]
                                                    || row.check_in)
                                                }
                                                onClick={() => handleProposeAttendanceCorrection(
                                                  op.id,
                                                  dateKey,
                                                  row.check_in ? String(row.check_in).slice(0, 8) : '',
                                                )}
                                              >
                                                {attendanceProposeSavingKey === `${op.id}:${dateKey}`
                                                  ? t('saving')
                                                  : 'Propose Correction'}
                                              </button>
                                            </div>
                                            {attendanceProposeError[`${op.id}:${dateKey}`] ? (
                                              <span style={{ color: '#e94560', fontSize: 10 }}>
                                                {attendanceProposeError[`${op.id}:${dateKey}`]}
                                              </span>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td style={{ padding: '8px 6px', color: '#8896a8', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                          {row.check_out ? `${formatTimeHHMM(row.check_out)} IST` : '—'}
                                        </td>
                                        <td style={{
                                          padding: '8px 6px',
                                          color: '#c9a84c',
                                          fontWeight: 700,
                                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                                        }}
                                        >
                                          {formatOwnerAttendanceHmrDisplay(row.hmr)}
                                        </td>
                                        <td style={{ padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                            <select
                                              style={{ ...s.input, fontSize: 11, padding: '4px 8px', minWidth: 110 }}
                                              value={draftStatus}
                                              onChange={(e) => {
                                                setAttendanceEditDraft((prev) => ({
                                                  ...prev,
                                                  [op.id]: {
                                                    ...(prev[op.id] || {}),
                                                    [dateKey]: e.target.value,
                                                  },
                                                }));
                                              }}
                                            >
                                              {OWNER_ATTENDANCE_STATUSES.map((statusOption) => (
                                                <option key={statusOption} value={statusOption}>
                                                  {formatOwnerAttendanceStatus(statusOption, t)}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              style={{ ...s.confirmBtn, fontSize: 10, padding: '4px 10px' }}
                                              disabled={!statusChanged || isSavingRow}
                                              onClick={() => handleSaveAttendanceStatus(op.id, dateKey)}
                                            >
                                              {isSavingRow ? t('saving') : t('ownerAttendanceSave')}
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <p style={{ color: '#8896a8', fontSize: 11, margin: 0 }}>
                              {t('presentLabel')}: {attendanceMonthSummary.present}
                              {' | '}
                              {t('halfDayLabel')}: {attendanceMonthSummary.halfday}
                              {' | '}
                              {t('absentLabel')}: {attendanceMonthSummary.absent}
                              {' | '}
                              {t('paidLeaveLabel')}/{t('unpaidLeaveLabel')}: {attendanceMonthSummary.leave}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: GPS TRACKING ═══ */}
        {activeTab === 'tracking' && (
          <div>
            {displayMachines.length === 0 && (
              <div style={{ ...s.tableCard, textAlign: 'center', padding: '32px' }}>
                <p style={{ fontSize: '32px', margin: '0 0 8px' }}>{String.fromCodePoint(0x1F4CD)}</p>
                <p style={{ color: '#c9a84c', fontWeight: 700, margin: '0 0 4px' }}>{t('noMachinesTrack')}</p>
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('noMachinesTrackHint')}</p>
              </div>
            )}
            {displayMachines.map((m, i) => {
              const siteLat = Number(m.activeBooking?.site_lat);
              const siteLng = Number(m.activeBooking?.site_lng);
              const hasSiteCoords = Number.isFinite(siteLat) && Number.isFinite(siteLng);
              const isActiveStatus = String(m.status).toLowerCase() === 'active';
              return (
                <div key={i} style={{ ...s.tableCard, marginBottom: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                    <h3 style={{ color: '#c9a84c', margin: 0, fontSize: '14px' }}>📍 {m.id} — {m.name}</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      <span style={{
                        background: isActiveStatus ? 'rgba(76,175,80,0.15)' : 'rgba(136,150,168,0.15)',
                        border: `1px solid ${isActiveStatus ? '#4CAF50' : '#8896a8'}`,
                        color: isActiveStatus ? '#4CAF50' : '#8896a8',
                        padding: '3px 10px',
                        borderRadius: '20px',
                        fontSize: '11px',
                      }}
                      >
                        {statusLabel(m.status, t)}
                      </span>
                      {m.activeBooking && bookingNeedsLiveSync(m.activeBooking) && (
                        <span style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid #4CAF50', color: '#4CAF50', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>{t('gpsLiveLabel')}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '8px', marginBottom: '10px' }}>
                    {[
                      { label: `🔑 ${t('ignition')}`, val: m.status === 'Active' ? t('on') : t('off') },
                      { label: `⛽ ${t('fuel')}`, val: fuelDisplay(m.fuel, m.fuelCapacity) },
                      { label: `⏱️ ${t('hmrToday')}`, val: formatHoursHm(m.hmr) },
                      { label: `👷 ${t('operator')}`, val: m.operator?.name || '--' },
                    ].map((d, j) => (
                      <div key={j} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                        <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 2px' }}>{d.label}</p>
                        <p style={{ color: '#c9a84c', fontWeight: '700', fontSize: '13px', margin: 0 }}>{d.val}</p>
                      </div>
                    ))}
                  </div>
                  {m.activeBooking ? (
                    <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(201,168,76,0.15)', marginBottom: '10px' }}>
                      <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 4px' }}>{t('siteAddressLabel')}</p>
                      <p style={{ color: '#e8e0d0', fontSize: '12px', fontWeight: 600, margin: '0 0 8px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        {m.activeBooking.site_address || t('siteLocationNotCaptured')}
                      </p>
                      {hasSiteCoords && (
                        <a
                          href={`https://www.google.com/maps?q=${siteLat},${siteLng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginBottom: '8px', color: '#c9a84c', fontSize: '12px', fontWeight: 600 }}
                        >
                          {t('navigateToSite')}
                        </a>
                      )}
                      <p style={{ color: '#8896a8', fontSize: '11px', margin: 0 }}>
                        {t('bookingRefLabel')}: <span style={{ color: '#c9a84c' }}>{m.activeBooking.booking_ref || '—'}</span>
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: '#8896a8', fontSize: '12px', textAlign: 'center', margin: '0 0 10px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                      {t('noActiveBookingIdle')}
                    </p>
                  )}
                  <button
                    type="button"
                    style={{ width: '100%', padding: '9px', background: 'rgba(233,69,96,0.1)', border: '1px solid rgba(233,69,96,0.4)', color: '#e94560', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                    onClick={() => alert(t('remoteLockAlert'))}
                  >
                    {t('remoteLockMachine')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ TAB: PAYOUT WALLET ═══ */}
        {settlementFlash && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ ...s.tableCard, maxWidth: '400px', width: '100%', textAlign: 'center', border: '2px solid #c9a84c' }}>
              <p style={{ fontSize: '40px', margin: '0 0 8px' }}>{String.fromCodePoint(0x1F4B0)}</p>
              <h2 style={{ color: '#c9a84c', margin: '0 0 10px', fontSize: '20px' }}>{t('ownerPaymentReceivedTitle')}</h2>
              <p style={{ color: '#e8e0d0', fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }}>
                {t('ownerPaymentReceivedBody')
                  .replace('{gross}', settlementFlash.gross.toLocaleString('en-IN'))
                  .replace('{net}', settlementFlash.net.toLocaleString('en-IN'))}
              </p>
              {settlementFlash.pending && (
                <p style={{ color: '#FF9800', fontSize: '11px', margin: '0 0 12px' }}>{t('ownerPaymentPendingWallet')}</p>
              )}
              <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 14px' }}>{settlementFlash.bookingRef}</p>
              <button type="button" style={{ padding: '10px 24px', background: '#c9a84c', color: '#0a1628', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }} onClick={() => setSettlementFlash(null)}>{t('okLabel')}</button>
            </div>
          </div>
        )}

        {activeTab === 'wallet' && (
          <div>
            <div style={{ ...s.tableCard, marginBottom: '16px', background: 'linear-gradient(135deg, #0f2040, #0a1628)' }}>
              <p style={{ color: '#8896a8', fontSize: '11px', letterSpacing: '2px', margin: '0 0 6px' }}>{t('ownerPayoutWalletBalance')}</p>
              <h2 style={{ color: '#c9a84c', fontSize: isMobile ? '32px' : '42px', fontWeight: 900, margin: '0 0 8px' }}>
                {walletLoading ? '…' : `₹${walletBalance.toLocaleString('en-IN')}`}
              </h2>
              <p style={{ color: '#8896a8', fontSize: '11px', margin: 0, lineHeight: 1.45 }}>{t('ownerPayoutWalletHint')}</p>
            </div>

            <div style={{ ...s.tableCard, marginBottom: '16px' }}>
              <h3 style={{ ...s.tableTitle, marginBottom: '10px' }}>{t('ownerPayoutHowTitle')}</h3>
              <ul style={{ color: '#8896a8', fontSize: '11px', lineHeight: 1.55, margin: 0, paddingLeft: '18px' }}>
                <li>{t('ownerPayoutHow1')}</li>
                <li>{t('ownerPayoutHow2')}</li>
                <li>{t('ownerPayoutHow3')}</li>
              </ul>
            </div>

            <div style={{ ...s.tableCard, marginBottom: '16px' }}>
              <h3 style={{ ...s.tableTitle, marginBottom: '10px' }}>{t('ownerWithdrawTitle')}</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min="1000"
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  placeholder={t('ownerWithdrawAmount')}
                  style={{ flex: '1 1 140px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(201,168,76,0.3)', background: 'rgba(0,0,0,0.35)', color: '#e8e0d0' }}
                />
                <button
                  type="button"
                  disabled={withdrawSubmitting || walletBalance < 1000}
                  onClick={handleWithdrawRequest}
                  style={{ padding: '10px 16px', background: 'linear-gradient(135deg, #c9a84c, #8b6914)', color: '#0a1628', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: withdrawSubmitting ? 'wait' : 'pointer', opacity: withdrawSubmitting ? 0.7 : 1 }}
                >
                  {withdrawSubmitting ? t('pleaseWait') : t('ownerWithdrawSubmit')}
                </button>
              </div>
              <p style={{ color: '#8896a8', fontSize: '10px', margin: '8px 0 0' }}>{t('ownerWithdrawMin')}</p>
            </div>

            <div style={s.tableCard}>
              <h3 style={{ ...s.tableTitle, marginBottom: '12px' }}>{t('ownerPayoutTxnTitle')}</h3>
              {walletLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px' }}>{t('loading')}</p>
              ) : walletTxns.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('ownerPayoutTxnEmpty')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...s.table, minWidth: '480px' }}>
                    <thead>
                      <tr>
                        {[t('date'), t('txnDescription'), t('amount'), t('status')].map((h) => (
                          <th key={h} style={s.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {walletTxns.map((tx) => {
                        const isCredit = String(tx.type || '').toLowerCase() === 'credit';
                        const amt = Number(tx.amount || 0);
                        return (
                          <tr key={tx.id || `${tx.reference}-${tx.created_at}`} style={s.tr}>
                            <td style={s.td}>{tx.created_at ? new Date(tx.created_at).toLocaleString('en-IN') : '—'}</td>
                            <td style={{ ...s.td, fontSize: '11px' }}>{tx.description || '—'}</td>
                            <td style={{ ...s.td, color: isCredit ? '#4CAF50' : '#e94560', fontWeight: 700 }}>
                              {isCredit ? '+' : '-'} ₹{amt.toLocaleString('en-IN')}
                            </td>
                            <td style={s.td}>{isCredit ? t('ownerPayoutCredit') : t('ownerPayoutDebit')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: REPORTS & PAY ═══ */}
        {activeTab === 'reports' && (
          <div>
            <div style={{ ...s.cardRow, gridTemplateColumns: gridCols(2, 3, 4) }}>
              {[
                { icon: '💰', val: fmtInr(reportSettlementStats.totalEarned), label: t('ownerTotalEarned') },
                { icon: '📅', val: fmtInr(reportSettlementStats.thisMonth), label: t('ownerThisMonth') },
                { icon: '⏳', val: fmtInr(reportSettlementStats.pending), label: t('ownerPendingSettlements') },
                { icon: '📋', val: `${reportSettlementStats.totalBookings}`, label: t('settlements') },
              ].map((c, i) => (
                <div key={i} style={s.card}>
                  <p style={s.cardIcon}>{c.icon}</p>
                  <h3 style={{ ...s.cardVal, fontSize: isMobile ? '14px' : '18px' }}>{c.val}</h3>
                  <p style={s.cardLbl}>{c.label}</p>
                </div>
              ))}
            </div>

            <div style={s.tableCard}>
              <h3 style={{ ...s.tableTitle, marginBottom: '12px' }}>💳 {t('paymentHistoryTitle')}</h3>
              {settlementsLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              ) : settlementsError ? (
                <div>
                  <p style={{ color: '#e94560', fontSize: '12px', margin: '0 0 10px' }}>{settlementsError}</p>
                  <button
                    type="button"
                    style={s.downloadBtn}
                    onClick={() => setSettlementsReload((n) => n + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : settlements.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('ownerSettlementsEmpty')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...s.table, minWidth: '800px' }}>
                    <thead>
                      <tr>
                        {[t('ownerBookingRef'), t('date'), t('gross'), t('commission'), 'TDS 2%', 'GST TCS 1%', t('netPaid'), t('status'), t('ownerReceiptPdf')].map((h) => (
                          <th key={h} style={s.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map((row) => {
                        const gross = Number(row.gross_amount || 0);
                        const commission = Number(row.commission_amount || 0);
                        const tds = Number(row.tds_amount || 0);
                        const tcs = Number(row.gst_tcs_amount || 0);
                        const net = Number(row.net_owner_amount || 0);
                        const rowId = row.id || row.booking_ref;
                        const dateLabel = row.created_at
                          ? new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—';
                        return (
                          <tr key={rowId} style={s.tr}>
                            <td style={{ ...s.td, color: '#c9a84c', fontSize: '11px' }}>{row.booking_ref || '—'}</td>
                            <td style={s.td}>{dateLabel}</td>
                            <td style={s.td}>{fmtInr(gross)}</td>
                            <td style={{ ...s.td, color: '#e94560' }}>- {fmtInr(commission)}</td>
                            <td style={{ ...s.td, color: '#e94560' }}>- {fmtInr(tds)}</td>
                            <td style={{ ...s.td, color: '#e94560' }}>- {fmtInr(tcs)}</td>
                            <td style={{ ...s.td, color: '#4CAF50', fontWeight: '700' }}>{fmtInr(net)}</td>
                            <td style={{ ...s.td, color: settlementStatusColor(row.status), fontWeight: 600, fontSize: '11px' }}>
                              {settlementStatusLabel(row.status)}
                            </td>
                            <td style={s.td}>
                              <button
                                type="button"
                                style={{ ...s.downloadBtn, padding: '6px 10px', fontSize: '10px' }}
                                disabled={receiptGeneratingId === rowId}
                                onClick={() => handleSettlementReceipt(row)}
                              >
                                {receiptGeneratingId === rowId ? t('ownerReceiptGenerating') : '⬇ PDF'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Bank Details */}
            <div style={{ ...s.tableCard, background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.2)' }}>
              <h3 style={{ ...s.tableTitle, marginBottom: '12px' }}>🏦 {t('bankDetailsTitle')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  { label: t('ownerBankName'), val: ownerBankProfile?.bank_name || '—' },
                  { label: t('accountNumber'), val: maskAccountNumber(ownerBankProfile?.account_number) },
                  { label: t('ifsc'), val: ownerBankProfile?.ifsc || '—' },
                  { label: t('ownerPanNumber'), val: maskPan(ownerBankProfile?.pan_number) },
                ].map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: '#8896a8', fontSize: '12px' }}>{d.label}</span>
                    <span style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '12px' }}>{d.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ TAB: FLEET ANALYTICS ═══ */}
        {activeTab === 'analytics' && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
              {[
                { months: 3, labelKey: 'analytics3Months' },
                { months: 6, labelKey: 'analytics6Months' },
                { months: 12, labelKey: 'analytics12Months' },
              ].map(({ months, labelKey }) => {
                const active = analyticsMonths === months;
                return (
                  <button
                    key={months}
                    type="button"
                    onClick={() => setAnalyticsMonths(months)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: `1px solid ${active ? '#c9a84c' : 'rgba(201,168,76,0.35)'}`,
                      background: active ? 'rgba(201,168,76,0.2)' : 'rgba(0,0,0,0.2)',
                      color: active ? '#c9a84c' : '#8896a8',
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 500,
                      fontSize: '12px',
                    }}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>

            <div style={{ ...s.cardRow, gridTemplateColumns: gridCols(2, 2, 4) }}>
              {analyticsLoading ? (
                <div style={{ ...s.card, gridColumn: '1 / -1' }}>
                  <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
                </div>
              ) : analyticsError ? (
                <div style={{ ...s.card, gridColumn: '1 / -1' }}>
                  <p style={{ color: '#e94560', fontSize: '12px', margin: '0 0 10px' }}>{analyticsError}</p>
                  <button type="button" style={s.downloadBtn} onClick={loadAnalytics}>
                    {t('retryLabel')}
                  </button>
                </div>
              ) : (
                [
                  { icon: '💰', val: fmtInr(analyticsData?.summary?.total_revenue), label: t('analyticsRevenue') },
                  { icon: '📋', val: `${analyticsData?.summary?.total_bookings ?? 0}`, label: t('analyticsBookings') },
                  { icon: '⏱️', val: formatHoursHm(analyticsData?.summary?.total_hours ?? 0), label: t('analyticsHours') },
                  { icon: '🚜', val: `${analyticsData?.summary?.active_machines ?? 0}`, label: t('analyticsActiveMachines') },
                ].map((c, i) => (
                  <div key={i} style={s.card}>
                    <p style={s.cardIcon}>{c.icon}</p>
                    <h3 style={{ ...s.cardVal, fontSize: isMobile ? '14px' : '18px' }}>{c.val}</h3>
                    <p style={s.cardLbl}>{c.label}</p>
                  </div>
                ))
              )}
            </div>

            <div style={{ ...s.tableCard, marginBottom: '16px' }}>
              <h3 style={{ ...s.tableTitle, marginBottom: '12px' }}>📈 {t('analyticsMonthlyTrend')}</h3>
              {analyticsLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              ) : analyticsError ? (
                <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{analyticsError}</p>
              ) : analyticsTrendSeries.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('analyticsNoData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={ANALYTICS_CHART_HEIGHT}>
                  <BarChart data={analyticsTrendSeries} margin={{ top: 12, right: 12, left: 4, bottom: 4 }} barCategoryGap="20%">
                    <defs>
                      <linearGradient id="ownerFleetBarGoldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ANALYTICS_CHART_GOLD_LIGHT} />
                        <stop offset="100%" stopColor={ANALYTICS_CHART_GOLD} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={ANALYTICS_CHART_GRID} strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: ANALYTICS_CHART_AXIS, fontSize: 11 }} axisLine={{ stroke: ANALYTICS_CHART_GRID }} tickLine={false} />
                    <YAxis
                      tick={{ fill: ANALYTICS_CHART_AXIS, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={formatAnalyticsRevenue}
                      domain={[0, analyticsMaxRevenue * 1.1]}
                    />
                    <Tooltip content={<FleetAnalyticsTooltip bookingsLabel={t('analyticsBookings')} />} />
                    <Bar dataKey="revenue" fill="url(#ownerFleetBarGoldGrad)" radius={[8, 8, 0, 0]} maxBarSize={56} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={s.tableCard}>
              <h3 style={{ ...s.tableTitle, marginBottom: '12px' }}>🚜 {t('analyticsMachineTable')}</h3>
              {analyticsLoading ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
              ) : analyticsError ? (
                <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{analyticsError}</p>
              ) : displayFleetMachines.length === 0 ? (
                <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('analyticsNoData')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...s.table, minWidth: '720px' }}>
                    <thead>
                      <tr>
                        {[t('machine'), t('revenue'), t('analyticsBookings'), t('analyticsHours'), t('analyticsLastBooking'), t('status')].map((h) => (
                          <th key={h} style={s.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayFleetMachines.map((row) => {
                        const lastBookingLabel = row.last_booking_date
                          ? new Date(row.last_booking_date).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })
                          : '—';
                        const machineLabel = row.machine_name
                          ? `${row.machine_id} · ${row.machine_name}`
                          : row.machine_id;
                        return (
                          <tr key={row.machine_uuid || row.machine_id} style={s.tr}>
                            <td style={{ ...s.td, color: '#c9a84c', fontWeight: 700 }}>{machineLabel}</td>
                            <td style={{ ...s.td, color: '#c9a84c', fontWeight: 700 }}>{fmtInr(row.total_revenue)}</td>
                            <td style={s.td}>{row.total_bookings ?? 0}</td>
                            <td style={s.td}>{formatHoursHm(row.total_hours ?? 0)}</td>
                            <td style={s.td}>{lastBookingLabel}</td>
                            <td style={s.td}>
                              <span style={{
                                ...s.statusBadge,
                                background: row.status === 'Active' ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)',
                                border: `1px solid ${row.status === 'Active' ? '#4CAF50' : '#FF9800'}`,
                                color: row.status === 'Active' ? '#4CAF50' : '#FF9800',
                              }}
                              >
                                {statusLabel(row.status, t)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: SETTINGS — Bank & Tax ═══ */}
        {activeTab === 'settings' && (
          <div style={s.tableCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ ...s.tableTitle, margin: 0 }}>🏦 {t('ownerBankTaxDetails')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <p style={{ color: '#8896a8', fontSize: '11px', margin: 0 }}>Registered Mobile: {sessionUser.phone}</p>
                <button type="button" style={s.downloadBtn} onClick={() => setShowPhoneChangeModal(true)}>Change Mobile Number</button>
              </div>
              {!ownerBankProfileEditing && !ownerBankProfileLoading && (
                <button type="button" style={s.downloadBtn} onClick={startOwnerBankProfileEdit}>
                  {t('ownerEditProfile')}
                </button>
              )}
            </div>
            <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 14px', lineHeight: 1.45 }}>{t('ownerBankTaxHint')}</p>
            {ownerBankProfileSuccess && (
              <p style={{ color: '#4CAF50', fontSize: '12px', margin: '0 0 12px' }}>{ownerBankProfileSuccess}</p>
            )}
            {ownerBankProfileLoading ? (
              <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>{t('loading')}</p>
            ) : ownerBankProfileError && !ownerBankProfileEditing ? (
              <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{ownerBankProfileError}</p>
            ) : ownerBankProfileEditing ? (
              <div style={{ display: 'grid', gap: '10px' }}>
                {[
                  { key: 'account_holder_name', label: t('ownerAccountHolderName') },
                  { key: 'bank_name', label: t('ownerBankName') },
                  { key: 'account_number', label: t('accountNumber'), type: 'text' },
                  { key: 'ifsc', label: t('ifsc') },
                  { key: 'pan_number', label: t('ownerPanNumber') },
                  { key: 'gstin', label: `${t('gstin')} (${t('optionalLabel')})` },
                ].map((field) => (
                  <div key={field.key}>
                    <p style={{ color: '#8896a8', fontSize: '10px', margin: '0 0 4px' }}>{field.label}</p>
                    <input
                      style={s.input}
                      value={ownerBankProfileForm[field.key]}
                      onChange={(e) => setOwnerBankProfileForm((prev) => ({
                        ...prev,
                        [field.key]: field.key === 'ifsc' || field.key === 'pan_number' || field.key === 'gstin'
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                      }))}
                    />
                  </div>
                ))}
                {ownerBankProfileError && (
                  <p style={{ color: '#e94560', fontSize: '12px', margin: 0 }}>{ownerBankProfileError}</p>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button type="button" style={{ ...s.confirmBtn, flex: 1 }} disabled={ownerBankProfileSaving} onClick={handleOwnerBankProfileSave}>
                    {ownerBankProfileSaving ? t('pleaseWait') : t('ownerSaveProfile')}
                  </button>
                  <button
                    type="button"
                    style={s.cancelBtn}
                    disabled={ownerBankProfileSaving}
                    onClick={() => { setOwnerBankProfileEditing(false); setOwnerBankProfileError(''); }}
                  >
                    {t('ownerCancelEdit')}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  { label: t('ownerAccountHolderName'), val: ownerBankProfile?.account_holder_name || ownerDisplayName || '—' },
                  { label: t('ownerBankName'), val: ownerBankProfile?.bank_name || '—' },
                  { label: t('accountNumber'), val: maskAccountNumber(ownerBankProfile?.account_number) },
                  { label: t('ifsc'), val: ownerBankProfile?.ifsc || '—' },
                  { label: t('ownerPanNumber'), val: maskPan(ownerBankProfile?.pan_number) },
                  { label: t('gstin'), val: ownerBankProfile?.gstin || '—' },
                ].map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: '#8896a8', fontSize: '12px' }}>{d.label}</span>
                    <span style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '12px' }}>{d.val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Route auto-settlement setup */}
            <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(201,168,76,0.2)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                <h4 style={{ ...s.tableTitle, fontSize: '13px', margin: 0 }}>⚡ Auto-Settlement (Razorpay Route)</h4>
                <span
                  style={{
                    ...s.statusBadge,
                    background: ownerBankProfile?.route_settlement_enabled
                      ? 'rgba(76,175,80,0.15)'
                      : 'rgba(255,152,0,0.15)',
                    border: `1px solid ${ownerBankProfile?.route_settlement_enabled ? '#4CAF50' : '#FF9800'}`,
                    color: ownerBankProfile?.route_settlement_enabled ? '#4CAF50' : '#FF9800',
                  }}
                >
                  {ownerBankProfile?.route_settlement_enabled
                    ? 'route_settlement_enabled'
                    : 'route_settlement_disabled'}
                </span>
              </div>
              <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 12px', lineHeight: 1.45 }}>
                Create a Razorpay Route linked account from your bank details. Finance admin enables Route settlement for automatic payouts.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: '#8896a8', fontSize: '12px' }}>razorpay_linked_account_id</span>
                  <span style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '12px', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' }}>
                    {ownerBankProfile?.razorpay_linked_account_id || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: '#8896a8', fontSize: '12px' }}>Linked status</span>
                  <span style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '12px' }}>
                    {ownerBankProfile?.razorpay_linked_account_status || '—'}
                  </span>
                </div>
              </div>
              {routeSetupSuccess && (
                <p style={{ color: '#4CAF50', fontSize: '12px', margin: '0 0 10px' }}>{routeSetupSuccess}</p>
              )}
              {routeSetupError && (
                <p style={{ color: '#e94560', fontSize: '12px', margin: '0 0 10px' }}>{routeSetupError}</p>
              )}
              <button
                type="button"
                style={s.confirmBtn}
                disabled={
                  routeSetupBusy
                  || isBankIncomplete
                  || Boolean(ownerBankProfile?.razorpay_linked_account_id)
                }
                onClick={handleSetupAutoSettlement}
              >
                {routeSetupBusy ? t('pleaseWait') : 'Set up Auto-Settlement'}
              </button>
              {isBankIncomplete && (
                <p style={{ color: '#FF9800', fontSize: '11px', margin: '10px 0 0' }}>
                  Complete bank name, account number, and IFSC before setup.
                </p>
              )}
              {ownerBankProfile?.razorpay_linked_account_id && !ownerBankProfile?.route_settlement_enabled && (
                <p style={{ color: '#8896a8', fontSize: '11px', margin: '10px 0 0' }}>
                  Linked account created. Waiting for finance admin to enable Route settlement.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB: KYC ═══ */}
        {activeTab === 'kyc' && (
          <OwnerKycForm
            authToken={localStorage.getItem('developmentexpress_token') || ''}
            apiBaseUrl={API_BASE_URL}
            onStatusChange={(status) => {
              setOwnerKycStatus(status);
              // KYC approval may auto-upgrade tier when bank details exist
              getOwnerProfile().then((result) => {
                if (result.profile) {
                  setOwnerBankProfile(result.profile);
                  applyOwnerProfileTier(result.profile);
                }
              });
            }}
          />
        )}

        {/* ═══ TAB: ALERTS ═══ */}
        {activeTab === 'alerts' && (
          <div style={s.tableCard}>
            <PushNotificationToggle />
            <h3 style={s.tableTitle}>🔔 {t('allAlerts')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '8px', marginBottom: '14px' }}>
              {[
                { icon: '📋', label: t('alertPendingBookings'), count: alertCounts.bookingsPending },
                { icon: '💰', label: t('alertPendingPayouts'), count: alertCounts.settlementsPending },
                { icon: '⛽', label: t('alertLowFuel'), count: alertCounts.lowFuelMachines },
                { icon: '🔧', label: t('alertOpenIssues'), count: alertCounts.openIssues },
                { icon: '📋', label: t('alertComplianceExpiring'), count: alertCounts.complianceAlerts },
                { icon: '🛠️', label: t('alertServiceDue'), count: alertCounts.serviceAlerts },
              ].map((badge) => (
                <div key={badge.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '8px 10px', fontSize: '11px', color: '#e8e0d0' }}>
                  {badge.icon} {badge.count} {badge.label}
                </div>
              ))}
            </div>
            {alertsLoading && (
              <p style={{ color: '#8896a8', fontSize: 13 }}>{t('loading')}</p>
            )}
            {!alertsLoading && alertsError && (
              <div style={{ textAlign: 'center', margin: '12px 0' }}>
                <p style={{ color: '#e94560', fontSize: 13, margin: '0 0 10px' }}>{alertsError}</p>
                <button
                  type="button"
                  onClick={loadAlerts}
                  style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontWeight: '600' }}
                >
                  {t('retryLabel')}
                </button>
              </div>
            )}
            {!alertsLoading && !alertsError && allAlerts.length === 0 && (
              <p style={{ color: '#8896a8', fontSize: 13 }}>
                {t('noAlertsNow')}
              </p>
            )}
            {!alertsLoading && !alertsError && allAlerts.length > 0 && allAlerts.map((a) => (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => a.link && setActiveTab(a.link)}
                onKeyDown={(e) => { if (e.key === 'Enter' && a.link) setActiveTab(a.link); }}
                style={{ ...s.alertRow, borderLeft: `3px solid ${a.color}`, marginBottom: '8px', cursor: a.link ? 'pointer' : 'default' }}
              >
                <span style={{ fontSize: '20px' }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ color: '#e8e0d0', fontSize: '13px', margin: '0 0 3px' }}>{ownerAlertMsg(a, t)}</p>
                  <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>
                    {a.time ? new Date(a.time).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
              </div>
            ))}

            <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(201,168,76,0.2)' }}>
              <h3 style={{ ...s.tableTitle, marginBottom: '10px' }}>
                {String.fromCodePoint(0x26A0)} {t('blacklistedClients')}
              </h3>
              {blacklistedClientsLoading && (
                <p style={{ color: '#8896a8', fontSize: 13 }}>{t('loading')}</p>
              )}
              {!blacklistedClientsLoading && blacklistedClientsError && (
                <p style={{ color: '#e94560', fontSize: 13 }}>{blacklistedClientsError}</p>
              )}
              {!blacklistedClientsLoading && !blacklistedClientsError && blacklistedClients.length === 0 && (
                <p style={{ color: '#8896a8', fontSize: 13 }}>{t('blacklistedClientsEmpty')}</p>
              )}
              {!blacklistedClientsLoading && !blacklistedClientsError && blacklistedClients.map((c) => (
                <div
                  key={c.id}
                  style={{
                    ...s.alertRow,
                    borderLeft: '3px solid #e94560',
                    marginBottom: '8px',
                    background: 'rgba(233,69,96,0.08)',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{String.fromCodePoint(0x1F6AB)}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: '#e8e0d0', fontSize: '13px', margin: '0 0 3px', fontWeight: 600 }}>
                      {c.name} · {c.phone}
                    </p>
                    <p style={{ color: '#ff9aa8', fontSize: '12px', margin: '0 0 3px' }}>
                      {c.blacklisted_reason || '—'}
                    </p>
                    <p style={{ color: '#8896a8', fontSize: '10px', margin: 0 }}>
                      {c.blacklisted_at
                        ? new Date(c.blacklisted_at).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                        : '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ TAB: NOTIFICATIONS ═══ */}
        {activeTab === 'notifications' && (
          <NotificationCenter
            authToken={localStorage.getItem('developmentexpress_token') || ''}
            apiEndpoint="/api/owner/notifications"
            title={t('notificationCenter')}
          />
        )}

        {/* ═══ TAB: TERMS ═══ */}
        {activeTab === 'terms' && (
          <div>
            <div style={{ ...s.tableCard, marginBottom: '15px' }}>
              <h3 style={s.tableTitle}>📜 Terms & Conditions</h3>
              <p style={{ color: '#8896a8', fontSize: '12px', margin: '0 0 10px', lineHeight: 1.5 }}>
                Review the latest platform legal documents. These links open the canonical policy pages.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  { label: 'Terms & Conditions', href: '/terms' },
                  { label: 'Privacy Policy', href: '/privacy' },
                  { label: 'Refund Policy', href: '/refund-policy' },
                  { label: 'Cancellation Policy', href: '/cancellation-policy' },
                  { label: 'Service Delivery Policy', href: '/service-delivery-policy' },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '10px', padding: '12px' }}>
                      <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: '13px', margin: 0 }}>{item.label}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ TAB: SUPPORT ═══ */}
        {activeTab === 'support' && (
          <div>
            <div style={{ ...s.tableCard, marginBottom: '15px' }}>
              <h3 style={s.tableTitle}>🆘 {t('contactCompany')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                <a href="tel:+918408000084" style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: '10px', padding: '16px', textAlign: 'center', cursor: 'pointer' }}>
                    <p style={{ fontSize: '28px', margin: '0 0 8px' }}>📞</p>
                    <p style={{ color: '#4CAF50', fontWeight: '700', fontSize: '14px', margin: '0 0 4px' }}>{t('callNow')}</p>
                    <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>+91-8408000084</p>
                  </div>
                </a>
                <a href="https://wa.me/918408000084" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '10px', padding: '16px', textAlign: 'center', cursor: 'pointer' }}>
                    <p style={{ fontSize: '28px', margin: '0 0 8px' }}>💬</p>
                    <p style={{ color: '#25D366', fontWeight: '700', fontSize: '14px', margin: '0 0 4px' }}>{t('whatsapp')}</p>
                    <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>+91-8408000084</p>
                  </div>
                </a>
                <a href="mailto:om.chavan2026@zohomail.in" style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '10px', padding: '16px', textAlign: 'center', cursor: 'pointer' }}>
                    <p style={{ fontSize: '28px', margin: '0 0 8px' }}>📧</p>
                    <p style={{ color: '#c9a84c', fontWeight: '700', fontSize: '14px', margin: '0 0 4px' }}>{t('emailLabel')}</p>
                    <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>om.chavan2026@zohomail.in</p>
                  </div>
                </a>
                <div style={{ background: 'rgba(21,101,192,0.1)', border: '1px solid rgba(21,101,192,0.3)', borderRadius: '10px', padding: '16px', textAlign: 'center', cursor: 'pointer' }}>
                  <p style={{ fontSize: '28px', margin: '0 0 8px' }}>📍</p>
                  <p style={{ color: '#1565C0', fontWeight: '700', fontSize: '14px', margin: '0 0 4px' }}>{t('officeLabel')}</p>
                  <p style={{ color: '#8896a8', fontSize: '12px', margin: 0 }}>Karad, Satara - 415110</p>
                </div>
              </div>
            </div>
            <div style={s.tableCard}>
              <h3 style={s.tableTitle}>📋 {t('companyDetailsTitle')}</h3>
              {[
                { label: t('company'), val: 'Development Express' },
                { label: t('md'), val: 'Om Chavan (B.Tech Civil)' },
                { label: t('gstin'), val: '27ABCDE1234F1Z5' },
                { label: t('sinceLabel'), val: '2011 (15 Years)' },
                { label: t('commission'), val: t('commissionRate') },
                { label: t('paymentCycle'), val: t('threeWorkingDays') },
              ].map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: '#8896a8', fontSize: '12px' }}>{d.label}</span>
                  <span style={{ color: '#e8e0d0', fontWeight: '600', fontSize: '12px' }}>{d.val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>

      <PhoneChangeModal
        isOpen={showPhoneChangeModal}
        onClose={() => setShowPhoneChangeModal(false)}
        userRole={sessionUser.role || 'owner'}
        authToken={localStorage.getItem('developmentexpress_token') || ''}
        onPhoneChanged={handleOwnerPhoneChanged}
      />

      {loadingMilestoneModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
        >
          <div style={{
            width: '100%',
            maxWidth: '430px',
            background: '#030810',
            border: '1px solid rgba(201,168,76,0.35)',
            borderRadius: '12px',
            padding: '18px',
          }}
          >
            <h3 style={{ color: '#c9a84c', margin: '0 0 8px', fontSize: '15px' }}>
              Submit Loading Milestone
            </h3>
            <p style={{ color: '#8896a8', fontSize: '11px', margin: '0 0 14px' }}>
              Booking #{loadingMilestoneModal.booking_ref || loadingMilestoneModal.id}
              {' · '}
              Transport ₹{Number(loadingMilestoneModal.mobilization_transport_amount || 0).toLocaleString('en-IN')}
            </p>
            <label style={{ display: 'block', color: '#8896a8', fontSize: '11px', marginBottom: '12px' }}>
              Loading photo (required)
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setLoadingPhotoFile(e.target.files?.[0] || null)}
                style={{ display: 'block', marginTop: '6px', width: '100%', color: '#e8e0d0', fontSize: '12px' }}
              />
            </label>
            <label style={{ display: 'block', color: '#8896a8', fontSize: '11px', marginBottom: '12px' }}>
              Transport receipt (optional)
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setLoadingReceiptFile(e.target.files?.[0] || null)}
                style={{ display: 'block', marginTop: '6px', width: '100%', color: '#e8e0d0', fontSize: '12px' }}
              />
            </label>
            {loadingMilestoneError && (
              <p style={{ color: '#e94560', fontSize: '11px', margin: '0 0 10px' }}>{loadingMilestoneError}</p>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setLoadingMilestoneModal(null);
                  setLoadingPhotoFile(null);
                  setLoadingReceiptFile(null);
                  setLoadingMilestoneError('');
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#8896a8',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(loadingMilestoneBusyId)}
                onClick={handleSubmitLoadingMilestone}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'linear-gradient(135deg, #a07830, #e2c97e)',
                  border: 'none',
                  color: '#030810',
                  borderRadius: '8px',
                  fontWeight: 800,
                  cursor: loadingMilestoneBusyId ? 'wait' : 'pointer',
                  opacity: loadingMilestoneBusyId ? 0.7 : 1,
                }}
              >
                {loadingMilestoneBusyId ? t('loading') : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {terminationModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1200,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
        >
          <div style={{
            width: '100%',
            maxWidth: '430px',
            background: '#030810',
            border: '1px solid rgba(136,150,168,0.35)',
            borderRadius: '12px',
            padding: '18px',
          }}
          >
            <h3 style={{ color: '#aab4c3', margin: '0 0 12px', fontSize: '15px' }}>
              Request contract termination
            </h3>
            <label style={{ display: 'block', color: '#8896a8', fontSize: '11px', marginBottom: '10px' }}>
              Termination type
              <select
                value={terminationType}
                onChange={(e) => setTerminationType(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0a1628',
                  color: '#e8e0d0',
                }}
              >
                <option value="owner">Owner</option>
                <option value="mutual">Mutual</option>
                <option value="force_majeure">Force Majeure</option>
              </select>
            </label>
            {terminationType === 'force_majeure' && (
              <label style={{ display: 'block', color: '#8896a8', fontSize: '11px', marginBottom: '10px' }}>
                Force majeure reason
                <textarea
                  value={forceMajeureReason}
                  onChange={(e) => setForceMajeureReason(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    marginTop: '6px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: '#0a1628',
                    color: '#e8e0d0',
                    boxSizing: 'border-box',
                  }}
                />
              </label>
            )}
            {(() => {
              const fee = estimateOwnerTerminationFee(terminationModal, terminationType);
              return (
                <div style={{
                  marginBottom: '10px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(0,0,0,0.35)',
                  fontSize: '12px',
                  color: '#e8e0d0',
                }}
                >
                  {(terminationType === 'mutual' || terminationType === 'force_majeure') ? (
                    <p style={{ margin: 0 }}>Estimated fee: ₹0 (no early-termination fee)</p>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 4px' }}>
                        Est. remaining cycles: {fee.remaining} (fee capped at {fee.feeCycles} × 25%)
                      </p>
                      <p style={{ margin: 0, fontWeight: 700, color: '#aab4c3' }}>
                        Est. fee: ₹{fee.net.toLocaleString('en-IN')}
                        {' '}(₹{fee.gross.toLocaleString('en-IN')} + GST ₹{fee.gst.toLocaleString('en-IN')})
                      </p>
                      <p style={{ margin: '6px 0 0', fontSize: '10px', color: '#8896a8' }}>
                        Owner-initiated termination applies this fee estimate.
                      </p>
                    </>
                  )}
                </div>
              );
            })()}
            <p style={{ color: '#FFB74D', fontSize: '11px', margin: '0 0 12px' }}>
              15-day notice period applies
            </p>
            {terminationError && (
              <p style={{ color: '#e94560', fontSize: '12px', margin: '0 0 10px' }}>{terminationError}</p>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                disabled={terminationSubmitting}
                onClick={() => setTerminationModal(null)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#8896a8',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={terminationSubmitting}
                onClick={handleOwnerInitiateTermination}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(136,150,168,0.45)',
                  background: 'rgba(40,40,50,0.7)',
                  color: '#aab4c3',
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: terminationSubmitting ? 0.7 : 1,
                }}
              >
                {terminationSubmitting ? 'Submitting…' : 'Confirm request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══ STYLES ═══
const s = {
  container: { display: 'flex', height: '100svh', maxHeight: '100svh', overflow: 'hidden', background: '#050d1a', fontFamily: 'Arial, sans-serif', color: '#fff', width: '100%' },
  containerMobile: { position: 'relative', display: 'block', minHeight: '100svh', width: '100%', maxWidth: '100vw', overflowX: 'hidden', background: '#050d1a', fontFamily: 'Arial, sans-serif', color: '#fff' },
  scrollShell: { position: 'relative', zIndex: 10, display: 'flex', flex: '1 1 0', flexDirection: 'column', minWidth: 0, minHeight: 0, width: '100%', overflow: 'hidden' },
  mainMobile: { display: 'block', width: '100%', maxWidth: '100%', boxSizing: 'border-box' },
  sidebar: { position: 'sticky', top: 0, alignSelf: 'flex-start', width: '230px', height: '100dvh', maxHeight: '100dvh', background: 'linear-gradient(180deg, #0f2040 0%, #0a1628 100%)', borderRight: '1px solid rgba(201,168,76,0.2)', padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, minHeight: 0, overflow: 'hidden' },
  sidebarLogo: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  sidebarHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' },
  sidebarHeaderBrand: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 },
  sidebarToggleBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(201,168,76,0.35)', background: 'rgba(201,168,76,0.1)', color: '#c9a84c', cursor: 'pointer', flexShrink: 0 },
  sidebarOpenFab: { position: 'fixed', left: 12, top: 'calc(12px + env(safe-area-inset-top, 0px))', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(201,168,76,0.35)', background: 'rgba(201,168,76,0.1)', color: '#c9a84c', cursor: 'pointer' },
  logoCircle: { width: '36px', height: '36px', background: 'linear-gradient(135deg, #a07830, #e2c97e)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', color: '#0a1628', fontSize: '12px', flexShrink: 0 },
  logoTitle: { color: '#c9a84c', fontWeight: '700', fontSize: '12px', margin: 0 },
  logoSub: { color: '#8896a8', fontSize: '10px', margin: 0 },
  divider: { height: '1px', background: 'rgba(201,168,76,0.15)', margin: '8px 0' },
  navSectionLabel: {
    color: '#8896a8',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    margin: '2px 4px 6px',
    padding: '0 8px',
  },
  navSectionToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    margin: '0 0 2px',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: '#8896a8',
    cursor: 'pointer',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  navSectionChevron: {
    display: 'inline-flex',
    width: 12,
    justifyContent: 'center',
    fontSize: 8,
    color: '#c9a84c',
    flexShrink: 0,
  },
  ownerCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(201,168,76,0.08)', borderRadius: '10px', margin: '4px 0' },
  ownerAvatar: { width: '36px', height: '36px', background: 'linear-gradient(135deg, #a07830, #e2c97e)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0a1628', fontWeight: '900', fontSize: '14px', flexShrink: 0 },
  ownerName: { color: '#c9a84c', fontWeight: '700', fontSize: '12px', margin: 0 },
  ownerSub: { color: '#8896a8', fontSize: '10px', margin: 0 },
  nav: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: '#8896a8', cursor: 'pointer', fontSize: '12px', width: '100%', textAlign: 'left' },
  navActive: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', border: '1px solid rgba(201,168,76,0.6)', background: 'linear-gradient(to right, rgba(201,168,76,0.25), rgba(201,168,76,0.05))', boxShadow: '0 0 24px rgba(201,168,76,0.2)', color: '#c9a84c', cursor: 'pointer', fontSize: '12px', width: '100%', textAlign: 'left', fontWeight: '700' },
  logoutBtn: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '8px', border: '1px solid rgba(233,69,96,0.3)', background: 'rgba(233,69,96,0.08)', color: '#e94560', cursor: 'pointer', fontSize: '12px', width: '100%', marginTop: 'auto' },
  sidebarFooter: { color: 'rgba(201,168,76,0.4)', fontSize: '9px', textAlign: 'center', marginTop: '8px', letterSpacing: '1px' },
  main: { flex: '1 1 0', minWidth: 0, minHeight: 0, overflowY: 'scroll', overflowX: 'hidden', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  pageTitle: { color: '#c9a84c', fontWeight: '700', margin: '0 0 4px' },
  pageDate: { color: '#8896a8', fontSize: '11px', margin: 0 },
  ownerBadge: { display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', padding: '8px 14px', borderRadius: '20px', color: '#c9a84c', fontSize: '12px' },
  onlineDot: { width: '7px', height: '7px', background: '#4CAF50', borderRadius: '50%', display: 'inline-block' },
  cardRow: { display: 'grid', gap: '12px', marginBottom: '18px' },
  card: { background: 'linear-gradient(135deg, #0f2040, #0a1628)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '12px', padding: '16px', textAlign: 'center' },
  cardIcon: { fontSize: '22px', margin: '0 0 6px' },
  cardVal: { color: '#c9a84c', fontWeight: '700', margin: '0 0 4px' },
  cardLbl: { color: '#8896a8', fontSize: '11px', margin: 0 },
  sectionTitle: { color: '#c9a84c', marginBottom: '14px', fontSize: '14px' },
  commissionCard: { background: 'linear-gradient(135deg, #0f2040, #0a1628)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '12px', padding: '18px', marginBottom: '18px' },
  tableCard: { background: 'linear-gradient(135deg, #0f2040, #0a1628)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '12px', padding: '18px', marginBottom: '18px' },
  tableTitle: { color: '#c9a84c', margin: '0 0 14px', fontSize: '14px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 10px', textAlign: 'left', color: 'rgba(201,168,76,0.7)', fontSize: '10px', letterSpacing: '1px', borderBottom: '1px solid rgba(201,168,76,0.15)', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.04)' },
  td: { padding: '10px', fontSize: '12px', color: '#e8e0d0', whiteSpace: 'nowrap' },
  machineTag: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  statusBadge: { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  alertRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' },
  downloadBtn: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px' },
  input: { width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '8px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' },
  label: { color: '#8896a8', fontSize: '11px', margin: '12px 0 5px' },
  cancelBtn: { flex: 1, padding: '11px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#8896a8', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
  confirmBtn: { padding: '11px', background: 'linear-gradient(135deg, #a07830, #e2c97e)', color: '#0a1628', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' },
};

export default OwnerDashboard;







