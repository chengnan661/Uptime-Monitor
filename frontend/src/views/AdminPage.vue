<template>
  <div class="min-h-screen flex flex-col text-slate-800 dark:text-slate-200">
    <!-- 背景光晕 -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      <div class="absolute -top-40 -right-40 w-[600px] h-[600px] bg-green-600/[0.02] dark:bg-green-600/[0.08] rounded-full blur-3xl"></div>
      <div class="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-600/[0.02] dark:bg-blue-600/[0.06] rounded-full blur-3xl"></div>
    </div>

    <!-- 登录弹窗 -->
    <LoginDialog v-if="!isAuthenticated" @login="onLogin" />

    <!-- 顶部导航 -->
    <AdminHeader v-if="isAuthenticated" :isDark="isDark" :loading="loading" :lastRefreshed="lastRefreshed"
      @toggle-theme="toggleTheme" @refresh="fetchMonitors" @logout="logout" />

    <!-- 主要内容 -->
    <main v-if="isAuthenticated" class="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
      <!-- 页面标题 -->
      <div class="mb-8 fade-up flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">管理控制台</h1>
          <p class="text-slate-500 text-sm mt-0.5">管理监控项目与通知配置</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button @click="showIncidents = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-flag text-xs"></i> 事件/维护
          </button>
          <button @click="showSettings = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-cog text-xs"></i> 站点设置
          </button>
          <button @click="exportMonitors" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-download text-xs"></i> 导出配置
          </button>
          <button @click="handleExportSla" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-file-csv text-xs"></i> SLA 月报
          </button>
          <button @click="showChannels = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-bell text-xs"></i> 通知渠道
          </button>
          <button @click="showAddModal = true" class="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-xl transition-all hover:shadow-lg hover:shadow-green-500/20 cursor-pointer">
            <i class="fas fa-plus text-xs"></i> 添加监控
          </button>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="mb-6 glass rounded-xl p-4 flex items-center gap-3 border border-orange-300 dark:border-orange-500/40 bg-orange-50/80 dark:bg-orange-500/10 fade-up">
        <i class="fas fa-exclamation-circle text-orange-400 shrink-0"></i>
        <p class="text-sm text-orange-300 flex-1">{{ error }}</p>
        <button @click="fetchMonitors" class="text-xs px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors font-medium cursor-pointer">重试</button>
      </div>

      <!-- 统计概览 -->
      <StatsOverview v-if="isAuthenticated && monitors.length > 0" :stats="stats" />

      <div v-if="isAuthenticated && health" class="mb-6 glass rounded-xl px-4 py-3 fade-up flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span class="font-semibold text-slate-500 dark:text-slate-400">系统状态</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">D1 {{ health.logs }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">Channels {{ health.enabled_channels }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">Daily {{ health.latest_daily_uptime || '-' }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">Last {{ formatDateFull(health.latest_log_at) }}</span>
        <button @click="fetchHealth" class="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold transition cursor-pointer" :class="health.ok ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-red-400 hover:bg-red-500/10'">
          <i class="fas" :class="health.ok ? 'fa-check-circle' : 'fa-exclamation-circle'"></i>
          {{ health.ok ? '自检正常' : '自检异常' }}
        </button>
      </div>

      <!-- 加载占位 -->
      <div v-if="loading && monitors.length === 0" class="space-y-3 fade-up-d2">
        <div v-for="i in 4" :key="i" class="glass rounded-xl h-16 animate-pulse"></div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="monitors.length === 0 && !loading"
        class="text-center py-20 glass rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 fade-up-d2">
        <div class="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-satellite-dish text-2xl text-slate-400 dark:text-slate-600"></i>
        </div>
        <h3 class="text-lg font-medium text-slate-900 dark:text-white">暂无监控项目</h3>
        <p class="text-slate-500 mt-1 mb-6 text-sm">点击上方「添加监控」开始配置</p>
        <button @click="showAddModal = true" class="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-xl transition-all shadow-sm hover:shadow-lg hover:shadow-green-500/20 cursor-pointer">
          <i class="fas fa-plus text-xs"></i> 添加第一个监控
        </button>
      </div>

      <!-- 监控列表 -->
      <MonitorList v-else
        :monitors="monitors" :filteredMonitors="filteredMonitors" :allTags="allTags"
        :activeTag="activeTag" :selectedIds="selectedIds" :searchQuery="searchQuery" :sortKey="sortKey"
        @update:activeTag="activeTag = $event" @update:selectedIds="selectedIds = $event"
        @update:searchQuery="searchQuery = $event" @update:sortKey="sortKey = $event"
        @force-check="forceCheck" @toggle-pause="togglePause" @open-config="openConfig"
        @view-logs="viewLogs" @clone="cloneMonitor" @delete="deleteMonitor"
        @batch-action="batchAction" @reorder="handleReorder"
      />
    </main>

    <!-- Footer -->
    <footer v-if="isAuthenticated" class="mt-auto py-5 border-t border-white/5">
      <div class="max-w-5xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-3">
        <p class="text-xs text-slate-600">
          &copy; {{ new Date().getFullYear() }} <a :href="footerUrl" target="_blank" class="hover:text-green-400 transition-colors font-medium">{{ footerAuthor }}</a>. All Rights Reserved.
        </p>
        <div class="flex items-center gap-4 text-xs text-slate-700 font-mono">
          <span><i class="fas fa-code-branch mr-1"></i>v1.4.0</span>
          <span><i class="fas fa-server mr-1"></i>Cloudflare Edge</span>
        </div>
      </div>
    </footer>

    <!-- 所有 Modal -->
    <AddMonitorModal v-if="showAddModal" :newMonitor="newMonitor" :submitting="submitting"
      @close="showAddModal = false" @submit="addMonitor" />

    <ConfigModal v-if="showConfig" :configTarget="configTarget" :configForm="configForm" :configSaving="configSaving"
      @close="showConfig = false" @save="saveConfig" />

    <LogsModal v-if="showLogs" :monitor="currentMonitor" :logs="logs" :logsLoading="logsLoading"
      :hasMoreLogs="hasMoreLogs" :sparkline="sparklineComputed" :uptimeStats="uptimeStats" :latencyPercentiles="latencyPercentiles"
      @close="showLogs = false" @load-more="loadMoreLogs" />

    <ChannelsModal v-if="showChannels" @close="showChannels = false" />

    <IncidentsModal v-if="showIncidents" :monitors="monitors" @close="showIncidents = false" />

    <SettingsModal v-if="showSettings" :monitors="monitors" @close="showSettings = false" @import-done="fetchMonitors" />

    <ConfirmDialog v-if="confirmModal.show" :message="confirmModal.message" @confirm="handleConfirm(true)" @cancel="handleConfirm(false)" />

    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useTheme } from '../composables/useTheme';
import { useToast } from '../composables/useToast';
import { API_BASE, fetchT, withRetry } from '../utils/api';
import { formatDateFull, getDaysRemaining, getExpiryClassAdmin } from '../utils/format';
import { exportSlaCsv } from '../utils/sla';

// 子组件
import LoginDialog from '../components/admin/LoginDialog.vue';
import AdminHeader from '../components/admin/AdminHeader.vue';
import StatsOverview from '../components/admin/StatsOverview.vue';
import MonitorList from '../components/admin/MonitorList.vue';
import AddMonitorModal from '../components/admin/AddMonitorModal.vue';
import ConfigModal from '../components/admin/ConfigModal.vue';
import LogsModal from '../components/admin/LogsModal.vue';
import ChannelsModal from '../components/admin/ChannelsModal.vue';
import IncidentsModal from '../components/admin/IncidentsModal.vue';
import SettingsModal from '../components/admin/SettingsModal.vue';
import ConfirmDialog from '../components/admin/ConfirmDialog.vue';
import ToastContainer from '../components/admin/ToastContainer.vue';

const { isDark, toggleTheme } = useTheme('admin_theme');
const { isAuthenticated, storedToken, logout } = useAuth();
const { addToast } = useToast();

const footerAuthor = import.meta.env.VITE_FOOTER_AUTHOR || 'Uptime Monitor';
const footerUrl = import.meta.env.VITE_FOOTER_URL || '#';

const monitors = ref([]);
const loading = ref(false);
const error = ref(null);
const lastRefreshed = ref('');
const health = ref(null);
const activeTag = ref('all');
const searchQuery = ref('');
const sortKey = ref('sort_order');
const selectedIds = ref([]);

const showAddModal = ref(false);
const showConfig = ref(false);
const showLogs = ref(false);
const showChannels = ref(false);
const showIncidents = ref(false);
const showSettings = ref(false);
const submitting = ref(false);
const configSaving = ref(false);

const confirmModal = ref({ show: false, message: '', resolve: null });

const newMonitor = ref({
    name: '', url: '', method: 'GET', interval: 300,
    keyword: '', user_agent: '', tags: '',
    request_headers: '', request_body: '',
    expected_codes: '200-299', channel_ids: '',
    check_ssl: true, check_domain: true, alert_error_rate: 0
});

const configTarget = ref(null);
const configForm = ref({});
const currentMonitor = ref(null);
const logs = ref([]);
const logsLoading = ref(false);
const hasMoreLogs = ref(false);
const uptimeStats = ref(null);

const authFetch = (url, opts = {}) => {
    const token = storedToken.value;
    const headers = { ...opts.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetchT(url, { ...opts, headers });
};

const onLogin = () => { fetchMonitors(); fetchHealth(); };

const fetchMonitors = async () => {
    loading.value = true;
    error.value = null;
    try {
        const r = await authFetch(`${API_BASE}/monitors`);
        if (r.ok) {
            monitors.value = await r.json();
            lastRefreshed.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else if (r.status === 401) {
            logout();
        } else {
            error.value = `拉取数据失败 (${r.status})`;
        }
    } catch { error.value = '连接服务器超时'; }
    finally { loading.value = false; }
};

const fetchHealth = async () => {
    try {
        const r = await fetchT(`${API_BASE}/health`);
        if (r.ok) health.value = await r.json();
    } catch {}
};

const stats = computed(() => {
    const total = monitors.value.length;
    const up = monitors.value.filter(m => m.status === 'UP').length;
    const down = monitors.value.filter(m => m.status === 'DOWN').length;
    const paused = monitors.value.filter(m => m.paused === 1 || m.status === 'PAUSED').length;
    return { total, up, down, paused };
});

const allTags = computed(() => {
    const set = new Set();
    for (const m of monitors.value) {
        if (m.tags) m.tags.split(',').forEach(t => { if (t.trim()) set.add(t.trim()); });
    }
    return [...set];
});

const filteredMonitors = computed(() => {
    let list = monitors.value;
    if (activeTag.value !== 'all') {
        list = list.filter(m => m.tags && m.tags.split(',').map(t => t.trim()).includes(activeTag.value));
    }
    if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase();
        list = list.filter(m => m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q));
    }
    return list;
});

const addMonitor = async () => {
    if (!newMonitor.value.name || !newMonitor.value.url) return;
    submitting.value = true;
    try {
        const payload = {
            ...newMonitor.value,
            check_ssl: newMonitor.value.check_ssl ? 1 : 0,
            check_domain: newMonitor.value.check_domain ? 1 : 0,
        };
        const r = await authFetch(`${API_BASE}/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (r.ok) {
            addToast('添加监控成功', 'success');
            showAddModal.value = false;
            newMonitor.value = { name: '', url: '', method: 'GET', interval: 300, keyword: '', user_agent: '', tags: '', request_headers: '', request_body: '', expected_codes: '200-299', channel_ids: '', check_ssl: true, check_domain: true, alert_error_rate: 0 };
            fetchMonitors();
        } else {
            const d = await r.json(); addToast(d.error || '添加失败', 'error');
        }
    } catch { addToast('请求失败', 'error'); }
    finally { submitting.value = false; }
};

const forceCheck = async (m) => {
    try {
        const r = await authFetch(`${API_BASE}/monitors/${m.id}/check`, { method: 'POST' });
        if (r.ok) { addToast(`已触发检测: ${m.name}`, 'info'); fetchMonitors(); }
    } catch { addToast('触发检测失败', 'error'); }
};

const togglePause = async (m) => {
    try {
        const r = await authFetch(`${API_BASE}/monitors/${m.id}/pause`, { method: 'PATCH' });
        if (r.ok) { fetchMonitors(); }
    } catch { addToast('操作失败', 'error'); }
};

const openConfig = (m) => {
    configTarget.value = m;
    configForm.value = {
        name: m.name, url: m.url, method: m.method || 'GET', interval: m.interval || 300,
        keyword: m.keyword || '', user_agent: m.user_agent || '', tags: m.tags || '',
        request_headers: m.request_headers || '', request_body: m.request_body || '',
        expected_codes: m.expected_codes || '200-299', channel_ids: m.channel_ids || '',
        check_ssl: (m.check_ssl ?? 1) === 1, check_domain: (m.check_domain ?? 1) === 1,
        alert_silence_uptime: m.alert_silence_uptime ?? 24, alert_silence_ssl: m.alert_silence_ssl ?? 24,
        alert_silence_domain: m.alert_silence_domain ?? 24, alert_error_rate: m.alert_error_rate ?? 0
    };
    showConfig.value = true;
};

const saveConfig = async () => {
    if (!configTarget.value) return;
    configSaving.value = true;
    try {
        const r = await authFetch(`${API_BASE}/monitors/${configTarget.value.id}/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configForm.value) });
        if (r.ok) { addToast('保存配置成功', 'success'); showConfig.value = false; fetchMonitors(); }
        else { const d = await r.json(); addToast(d.error || '保存失败', 'error'); }
    } catch { addToast('请求失败', 'error'); }
    finally { configSaving.value = false; }
};

const viewLogs = async (m) => {
    currentMonitor.value = m;
    logsLoading.value = true;
    showLogs.value = true;
    try {
        const [rLogs, rStats] = await Promise.all([
            authFetch(`${API_BASE}/monitors/${m.id}/logs?limit=50`),
            authFetch(`${API_BASE}/monitors/${m.id}/stats`),
        ]);
        if (rLogs.ok) logs.value = await rLogs.json();
        if (rStats.ok) uptimeStats.value = await rStats.json();
    } catch {}
    finally { logsLoading.value = false; }
};

const sparklineComputed = computed(() => {
    const list = [...logs.value].reverse().filter(l => l.is_fail === 0);
    return list.slice(-20).map(l => l.latency);
});

const latencyPercentiles = computed(() => {
    const valid = logs.value.filter(l => l.is_fail === 0 && l.latency > 0).map(l => l.latency).sort((a, b) => a - b);
    if (valid.length === 0) return { avg: 0, p95: 0, p99: 0 };
    const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    const p95 = valid[Math.floor(valid.length * 0.95)] || valid[valid.length - 1];
    const p99 = valid[Math.floor(valid.length * 0.99)] || valid[valid.length - 1];
    return { avg, p95, p99 };
});

const cloneMonitor = (m) => {
    newMonitor.value = {
        name: m.name + ' (副本)', url: m.url, method: m.method || 'GET', interval: m.interval || 300,
        keyword: m.keyword || '', user_agent: m.user_agent || '', tags: m.tags || '',
        request_headers: m.request_headers || '', request_body: m.request_body || '',
        expected_codes: m.expected_codes || '200-299', channel_ids: m.channel_ids || '',
        check_ssl: (m.check_ssl ?? 1) === 1, check_domain: (m.check_domain ?? 1) === 1,
        alert_error_rate: m.alert_error_rate ?? 0
    };
    showAddModal.value = true;
};

const deleteMonitor = async (m) => {
    confirmModal.value = { show: true, message: `确定要删除监控项「${m.name}」吗？此操作不可撤销。`, resolve: null };
    const ok = await new Promise(res => { confirmModal.value.resolve = res; });
    if (ok) {
        try {
            const r = await authFetch(`${API_BASE}/monitors/${m.id}`, { method: 'DELETE' });
            if (r.ok) { addToast('删除成功', 'success'); fetchMonitors(); }
        } catch { addToast('删除失败', 'error'); }
    }
};

const handleConfirm = (val) => {
    if (confirmModal.value.resolve) confirmModal.value.resolve(val);
    confirmModal.value.show = false;
};

const batchAction = async (action) => {
    if (selectedIds.value.length === 0) return;
    if (action === 'delete') {
        confirmModal.value = { show: true, message: `确定要批量删除选中的 ${selectedIds.value.length} 个监控项吗？`, resolve: null };
        const ok = await new Promise(res => { confirmModal.value.resolve = res; });
        if (!ok) return;
    }
    try {
        const r = await authFetch(`${API_BASE}/monitors/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: selectedIds.value }) });
        if (r.ok) { addToast('批量操作成功', 'success'); selectedIds.value = []; fetchMonitors(); }
    } catch { addToast('批量操作失败', 'error'); }
};

const handleReorder = async (ids) => {
    try { await authFetch(`${API_BASE}/monitors/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); addToast('排序已保存', 'success'); fetchMonitors(); } catch { addToast('排序保存失败', 'error'); }
};

const exportMonitors = () => {
    const data = monitors.value.map(m => ({ name: m.name, url: m.url, method: m.method, interval: m.interval, keyword: m.keyword, user_agent: m.user_agent, tags: m.tags, request_headers: m.request_headers, request_body: m.request_body, expected_codes: m.expected_codes, channel_ids: m.channel_ids }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.style.display = 'none'; a.href = URL.createObjectURL(blob); a.download = `uptime-monitors-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 200);
    addToast(`已导出 ${data.length} 个监控配置`, 'success');
};

const handleExportSla = () => {
    if (monitors.value.length === 0) { addToast('暂无可导出的监控项', 'info'); return; }
    exportSlaCsv(monitors.value);
    addToast('SLA 月度报告导出完成', 'success');
};

onMounted(() => {
    if (isAuthenticated.value) { fetchMonitors(); fetchHealth(); setInterval(fetchMonitors, 30000); }
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        if (e.key === 'Escape') { showAddModal.value = false; showLogs.value = false; showConfig.value = false; showChannels.value = false; showIncidents.value = false; showSettings.value = false; if (confirmModal.value.show) handleConfirm(false); }
        if ((e.key === 'n' || e.key === 'N') && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); showAddModal.value = true; }
        if ((e.key === 'r' || e.key === 'R') && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); fetchMonitors(); }
        if (e.key === '/' && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); document.querySelector('.search-input')?.focus(); }
    });
});
</script>
