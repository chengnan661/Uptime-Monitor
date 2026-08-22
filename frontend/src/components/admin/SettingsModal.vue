<template>
  <transition enter-active-class="transition duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="emit('close')"></div>

      <section class="relative w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col glass admin-modal rounded-2xl" style="animation:modal-in 0.25s ease-out">
        <header class="px-6 py-5 border-b border-white/5 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-indigo-500/15 rounded-xl flex items-center justify-center">
              <i class="fas fa-cog text-indigo-400"></i>
            </div>
            <div>
              <h3 class="text-lg font-bold text-white">站点设置</h3>
              <p class="text-xs text-slate-500">状态页信息、告警模板与配置导入</p>
            </div>
          </div>
          <button @click="emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer" aria-label="关闭">
            <i class="fas fa-times"></i>
          </button>
        </header>

        <form @submit.prevent="save" class="flex-1 min-h-0 flex flex-col">
          <div class="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6 border-b lg:border-b-0 lg:border-r border-white/5">
              <section class="space-y-4">
                <div>
                  <h4 class="text-sm font-semibold text-white">状态页信息</h4>
                  <p class="text-xs text-slate-500 mt-1">这些内容会展示在公开状态页的顶部。</p>
                </div>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">状态页标题</span>
                  <input v-model.trim="settings.site_title" placeholder="Uptime Monitor" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">页面描述</span>
                  <textarea v-model.trim="settings.site_description" rows="3" placeholder="实时监控服务运行状态" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none resize-none"></textarea>
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">Logo URL <span class="text-xs font-normal text-slate-500">可选</span></span>
                  <input v-model.trim="settings.site_logo_url" placeholder="https://example.com/logo.png" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  <span class="text-xs text-slate-500">填写后会替换状态页左上角默认图标。</span>
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">自定义页脚 / 备案信息 <span class="text-xs font-normal text-slate-500">可选</span></span>
                  <input v-model.trim="settings.custom_footer" placeholder="例如: 粤ICP备XXXXXXXX号" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                </label>
              </section>

              <section class="space-y-4">
                <div class="pt-2 border-t border-white/5">
                  <h4 class="text-sm font-semibold text-white mt-4">告警模板</h4>
                  <p class="text-xs text-slate-500 mt-1">模板会追加到通知消息里，用来解释异常原因和恢复信息。</p>
                </div>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">故障告警详情</span>
                  <textarea v-model.trim="settings.alert_template_down" rows="3" placeholder="错误原因: {reason}" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none resize-none"></textarea>
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">恢复通知详情</span>
                  <textarea v-model.trim="settings.alert_template_up" rows="3" placeholder="响应耗时: {latency}ms" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none resize-none"></textarea>
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">错误率告警详情</span>
                  <textarea v-model.trim="settings.alert_template_error_rate" rows="3" placeholder="错误率告警：过去 5 分钟内错误率 {error_rate}%，超过阈值 {threshold}%" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none resize-none"></textarea>
                </label>
              </section>
            </div>

            <aside class="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4 bg-slate-50/80 dark:bg-slate-950/20">
              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4">
                <h4 class="text-sm font-semibold text-white">作用范围</h4>
                <ul class="mt-3 space-y-2 text-xs text-slate-400">
                  <li class="flex gap-2">
                    <i class="fas fa-desktop text-emerald-400 mt-0.5"></i>
                    <span>标题、描述和 Logo 用于公开状态页。</span>
                  </li>
                  <li class="flex gap-2">
                    <i class="fas fa-bell text-emerald-400 mt-0.5"></i>
                    <span>告警模板用于故障、恢复和错误率通知。</span>
                  </li>
                  <li class="flex gap-2">
                    <i class="fas fa-file-import text-emerald-400 mt-0.5"></i>
                    <span>导入配置只新增监控项，不会覆盖现有项目。</span>
                  </li>
                </ul>
              </section>

              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4">
                <h4 class="text-sm font-semibold text-white">可用变量</h4>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span v-for="item in variables" :key="item" class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950/40 px-2 py-1 text-xs font-mono text-slate-500 dark:text-slate-300">{{ item }}</span>
                </div>
              </section>

              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4 space-y-3">
                <div>
                  <h4 class="text-sm font-semibold text-white">导入监控配置</h4>
                  <p class="text-xs text-slate-500 mt-1">支持导入后台导出的 JSON 文件。</p>
                </div>

                <label class="flex items-center gap-3 rounded-xl border border-dashed border-slate-700 px-4 py-4 cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition">
                  <span class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <i class="fas" :class="importing ? 'fa-spinner fa-spin' : 'fa-upload'"></i>
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-white">{{ importing ? '导入中' : '选择 JSON 文件' }}</span>
                    <span class="block text-xs text-slate-500 truncate">导入之前导出的监控配置</span>
                  </span>
                  <input type="file" accept=".json" @change="importMonitors" class="hidden" :disabled="importing">
                </label>
              </section>
            </aside>
          </div>

          <footer class="px-6 py-4 border-t border-white/5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/80 dark:bg-slate-950/20">
            <p class="text-xs text-slate-500">保存后，公开状态页和后续通知会使用最新配置。</p>
            <div class="flex items-center justify-end gap-3">
              <button type="button" @click="emit('close')" class="px-4 py-2.5 rounded-xl border border-slate-700 text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">
                取消
              </button>
              <button type="submit" :disabled="saving" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                <i class="fas mr-1.5" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
                {{ saving ? '保存中' : '保存设置' }}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { ref } from 'vue';
import { useAuth } from '../../composables/useAuth';
import { useToast } from '../../composables/useToast';
import { API_BASE, fetchT } from '../../utils/api';

const emit = defineEmits(['close', 'import-done']);
const { storedToken } = useAuth();
const { addToast } = useToast();
const saving = ref(false);
const importing = ref(false);
const variables = ['{name}', '{url}', '{reason}', '{latency}', '{status}', '{error_rate}', '{threshold}', '{time}'];
const settings = ref({
    site_title: 'Uptime Monitor',
    site_description: '',
    site_logo_url: '',
    alert_template_down: '',
    alert_template_up: '',
    alert_template_error_rate: '',
});

const authFetch = async (url, opts = {}) => fetchT(url, { ...opts, headers: { ...opts.headers, 'Authorization': `Bearer ${storedToken.value}` } });

const fetchSettings = async () => {
    try {
        const r = await fetchT(`${API_BASE}/settings`);
        if (r.ok) {
            const d = await r.json();
            settings.value = {
                site_title: d.site_title || 'Uptime Monitor',
                site_description: d.site_description || '',
                site_logo_url: d.site_logo_url || '',
                alert_template_down: d.alert_template_down || '',
                alert_template_up: d.alert_template_up || '',
                alert_template_error_rate: d.alert_template_error_rate || '',
            };
        }
    } catch {
        addToast('设置加载失败', 'error');
    }
};

const save = async () => {
    if (saving.value) return;
    saving.value = true;
    try {
        const r = await authFetch(`${API_BASE}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings.value),
        });
        if (r.ok) {
            addToast('设置已保存', 'success');
            emit('close');
        } else {
            addToast('保存失败', 'error');
        }
    } catch {
        addToast('网络错误', 'error');
    } finally {
        saving.value = false;
    }
};

const importMonitors = async (e) => {
    const file = e.target.files[0];
    if (!file || importing.value) return;
    importing.value = true;
    try {
        const text = await file.text();
        const items = JSON.parse(text);
        if (!Array.isArray(items)) {
            addToast('无效格式', 'error');
            return;
        }

        let ok = 0;
        for (const item of items) {
            const r = await authFetch(`${API_BASE}/monitors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item),
            });
            if (r.ok) ok++;
        }
        addToast(`导入 ${ok}/${items.length} 个成功`, 'success');
        emit('import-done');
        emit('close');
    } catch {
        addToast('导入失败', 'error');
    } finally {
        importing.value = false;
        e.target.value = '';
    }
};

fetchSettings();
</script>
