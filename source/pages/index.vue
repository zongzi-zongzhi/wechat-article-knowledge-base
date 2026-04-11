<script setup lang="ts">
import { request } from '#shared/utils/request';
import LoginModal from '~/components/modal/Login.vue';
import { websiteName } from '~/config';

interface StorageSettingsResponse {
  rootPath: string;
  exists: boolean;
}

interface BatchAccountsResponse {
  accounts: string[];
}

interface InspectAccountResponse {
  accountName: string;
  exists: boolean;
  mode: 'initial' | 'incremental';
  accountId: string | null;
  storagePath: string | null;
  totalArticles: number;
  lastSyncedAt: string | null;
}

interface SyncAccountResponse {
  mode: 'initial' | 'incremental';
  accountId: string;
  accountName: string;
  fetchedCount: number;
  newCount: number;
  totalArticles: number;
  lastSyncedAt: string;
}

type PageMode = 'single' | 'batch';
type BatchStatus = 'pending' | 'syncing' | 'success' | 'failed' | 'auth_required';

interface BatchSyncItem {
  accountName: string;
  status: BatchStatus;
  message: string;
  result?: SyncAccountResponse;
}

useHead({
  title: `一键抓取 | ${websiteName}`,
});

const modal = useModal();
const loginAccount = useLoginAccount();

const mode = ref<PageMode>('single');
const accountName = ref('');
const storagePath = ref('');
const batchInput = ref('');
const includeCover = ref(false);

const loadingSettings = ref(true);
const loadingBatchAccounts = ref(true);
const savingStorage = ref(false);
const savingBatchAccounts = ref(false);
const syncingSingle = ref(false);
const syncingBatch = ref(false);
const batchPausedForLogin = ref(false);

const singleError = ref('');
const batchError = ref('');

const inspectResult = ref<InspectAccountResponse | null>(null);
const syncResult = ref<SyncAccountResponse | null>(null);
const savedBatchAccounts = ref<string[]>([]);
const batchResults = ref<BatchSyncItem[]>([]);
const batchCursor = ref(0);

const isLoginExpired = computed(() => {
  return !!loginAccount.value?.expires && new Date(loginAccount.value.expires).getTime() <= Date.now();
});

const isLoggedIn = computed(() => !!loginAccount.value && !isLoginExpired.value);
const parsedBatchAccounts = computed(() => {
  return Array.from(
    new Set(
      batchInput.value
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
});

const canStartSingle = computed(() => !!accountName.value.trim() && !!storagePath.value.trim() && !syncingSingle.value && !syncingBatch.value);
const canStartBatch = computed(() => parsedBatchAccounts.value.length > 0 && !!storagePath.value.trim() && !syncingBatch.value && !syncingSingle.value);

const batchSummary = computed(() => {
  return {
    total: batchResults.value.length,
    success: batchResults.value.filter(item => item.status === 'success').length,
    failed: batchResults.value.filter(item => item.status === 'failed').length,
    pending: batchResults.value.filter(item => item.status === 'pending').length,
    authRequired: batchResults.value.filter(item => item.status === 'auth_required').length,
  };
});

function openLoginModal(message?: string) {
  loginAccount.value = null;
  if (message) {
    if (mode.value === 'batch') {
      batchError.value = message;
    } else {
      singleError.value = message;
    }
  }
  modal.open(LoginModal);
}

function isAuthError(error: any) {
  const message = `${error?.data?.statusMessage || error?.message || ''}`.toLowerCase();
  return (
    message.includes('session expired') ||
    message.includes('login') ||
    message.includes('expired') ||
    message.includes('unauthorized') ||
    message.includes('未登录') ||
    message.includes('登录') ||
    message.includes('过期')
  );
}

function formatStoragePath(rootPath: string, accountFolderName: string) {
  return `${rootPath.replace(/[\\/]+$/, '')}\\accounts\\${accountFolderName}`;
}

function getBatchStatusTone(status: BatchStatus) {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'syncing':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'auth_required':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function getBatchStatusLabel(status: BatchStatus) {
  switch (status) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'syncing':
      return '同步中';
    case 'auth_required':
      return '等待重新登录';
    default:
      return '等待中';
  }
}

async function loadSettings() {
  loadingSettings.value = true;

  try {
    const response = await request<StorageSettingsResponse>('/api/kb/settings/storage');
    storagePath.value = response.rootPath;
  } catch (error: any) {
    singleError.value = error?.message || '加载默认保存目录失败';
  } finally {
    loadingSettings.value = false;
  }
}

async function loadBatchAccounts() {
  loadingBatchAccounts.value = true;

  try {
    const response = await request<BatchAccountsResponse>('/api/kb/settings/batch-accounts');
    savedBatchAccounts.value = response.accounts;
    if (!batchInput.value.trim()) {
      batchInput.value = response.accounts.join('\n');
    }
  } catch (error: any) {
    batchError.value = error?.message || '加载批量清单失败';
  } finally {
    loadingBatchAccounts.value = false;
  }
}

async function saveStoragePath() {
  const nextPath = storagePath.value.trim();
  if (!nextPath) {
    throw new Error('请先输入保存目录');
  }

  savingStorage.value = true;
  try {
    const response = await request<StorageSettingsResponse>('/api/kb/settings/storage', {
      method: 'POST',
      body: {
        rootPath: nextPath,
      },
    });
    storagePath.value = response.rootPath;
    return response.rootPath;
  } finally {
    savingStorage.value = false;
  }
}

async function saveBatchAccounts() {
  savingBatchAccounts.value = true;
  batchError.value = '';

  try {
    const response = await request<BatchAccountsResponse>('/api/kb/settings/batch-accounts', {
      method: 'POST',
      body: {
        accounts: parsedBatchAccounts.value,
      },
    });
    savedBatchAccounts.value = response.accounts;
    batchInput.value = response.accounts.join('\n');
  } catch (error: any) {
    batchError.value = error?.message || '保存批量清单失败';
  } finally {
    savingBatchAccounts.value = false;
  }
}

function useSavedBatchAccounts() {
  batchInput.value = savedBatchAccounts.value.join('\n');
  batchError.value = '';
}

function ensureLogin(targetMode: PageMode) {
  if (loginAccount.value && !isLoginExpired.value) {
    return true;
  }

  mode.value = targetMode;
  openLoginModal('登录已过期，请重新扫码。');
  return false;
}

async function inspectAccount() {
  const targetName = accountName.value.trim();
  if (!targetName) {
    throw new Error('请先输入公众号名称');
  }

  await saveStoragePath();

  const response = await request<InspectAccountResponse>('/api/kb/accounts/inspect', {
    method: 'POST',
    body: {
      accountName: targetName,
    },
  });

  inspectResult.value = response;
  return response;
}

async function startSingleSync() {
  singleError.value = '';
  syncResult.value = null;

  if (!ensureLogin('single')) {
    return;
  }

  syncingSingle.value = true;

  try {
    const inspection = await inspectAccount();
    const response = await request<SyncAccountResponse>('/api/kb/accounts/sync', {
      method: 'POST',
      body: {
        accountName: inspection.accountName,
        includeCover: includeCover.value,
      },
    });

    syncResult.value = response;
    inspectResult.value = {
      accountName: response.accountName,
      exists: true,
      mode: 'incremental',
      accountId: response.accountId,
      storagePath: formatStoragePath(storagePath.value, response.accountName),
      totalArticles: response.totalArticles,
      lastSyncedAt: response.lastSyncedAt,
    };
  } catch (error: any) {
    if (isAuthError(error)) {
      openLoginModal('登录已过期，请重新扫码。');
      return;
    }

    singleError.value = error?.data?.statusMessage || error?.message || '同步失败';
  } finally {
    syncingSingle.value = false;
  }
}

async function startBatchSync(options?: { resume?: boolean }) {
  batchError.value = '';

  if (!ensureLogin('batch')) {
    return;
  }

  const targetAccounts = parsedBatchAccounts.value;
  if (!targetAccounts.length) {
    batchError.value = '请先输入至少一个公众号名称';
    return;
  }

  syncingBatch.value = true;
  batchPausedForLogin.value = false;

  try {
    await saveStoragePath();

    if (!options?.resume) {
      batchResults.value = targetAccounts.map(account => ({
        accountName: account,
        status: 'pending',
        message: '等待开始',
      }));
      batchCursor.value = 0;
    }

    for (let index = batchCursor.value; index < batchResults.value.length; index++) {
      const item = batchResults.value[index];
      batchCursor.value = index;
      item.status = 'syncing';
      item.message = '正在抓取并同步';

      try {
        const response = await request<SyncAccountResponse>('/api/kb/accounts/sync', {
          method: 'POST',
          body: {
            accountName: item.accountName,
            includeCover: includeCover.value,
          },
        });

        item.status = 'success';
        item.result = response;
        item.message = `${response.mode === 'incremental' ? '增量同步' : '首次抓取'}，新增 ${response.newCount} 篇，总计 ${response.totalArticles} 篇`;
        batchCursor.value = index + 1;
      } catch (error: any) {
        if (isAuthError(error)) {
          item.status = 'auth_required';
          item.message = '登录已过期，等待重新扫码后继续';
          batchPausedForLogin.value = true;
          openLoginModal('批量抓取过程中登录已过期，请重新扫码。');
          return;
        }

        item.status = 'failed';
        item.message = error?.data?.statusMessage || error?.message || '抓取失败';
        batchCursor.value = index + 1;
      }
    }
  } finally {
    syncingBatch.value = false;
  }
}

watch(accountName, () => {
  inspectResult.value = null;
  syncResult.value = null;
  singleError.value = '';
});

watch(storagePath, () => {
  inspectResult.value = null;
  syncResult.value = null;
  singleError.value = '';
  batchError.value = '';
});

onMounted(async () => {
  await Promise.all([loadSettings(), loadBatchAccounts()]);
});
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,#fef3c7,0,#fff8eb,35%,#f5f1e8,100%)] px-4 py-8">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <section class="overflow-hidden rounded-[28px] border border-black/10 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div class="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div class="space-y-6 px-6 py-8 sm:px-8 sm:py-10">
            <p class="inline-flex rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              微信公众号知识库
            </p>

            <div class="space-y-3">
              <h1 class="text-3xl font-black tracking-tight text-slate-900 sm:text-5xl">单抓一个，或者批量维护一组公众号</h1>
              <p class="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                单个抓取适合临时同步；批量抓取适合长期维护一批固定公众号。文章抓取后会自动生成索引，方便人和 AI 更好地使用该知识库。
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <button
                class="rounded-full px-5 py-2 text-sm font-semibold transition"
                :class="mode === 'single' ? 'bg-slate-950 text-white shadow-lg' : 'border border-slate-200 bg-white text-slate-700'"
                @click="mode = 'single'"
              >
                单个抓取
              </button>
              <button
                class="rounded-full px-5 py-2 text-sm font-semibold transition"
                :class="mode === 'batch' ? 'bg-slate-950 text-white shadow-lg' : 'border border-slate-200 bg-white text-slate-700'"
                @click="mode = 'batch'"
              >
                批量抓取
              </button>
            </div>

            <template v-if="mode === 'single'">
              <div class="grid gap-4">
                <label class="grid gap-2">
                  <span class="text-sm font-semibold text-slate-700">公众号名称</span>
                  <UInput v-model="accountName" size="xl" placeholder="例如：机器之心" />
                </label>
              </div>

              <label class="grid gap-2">
                <span class="text-sm font-semibold text-slate-700">保存的目录</span>
                <UInput
                  v-model="storagePath"
                  size="xl"
                  :loading="loadingSettings || savingStorage"
                  placeholder="例如：D:\\知识库\\公众号"
                />
              </label>

              <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input v-model="includeCover" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900" />
                <span>
                  是否要抓取封面图片
                  <span class="block text-xs leading-6 text-slate-500">勾选后，每篇文章目录里会额外保存一张封面图片；不勾选则只抓正文文件。</span>
                </span>
              </label>

              <div class="flex flex-wrap gap-3">
                <UButton color="black" size="xl" :loading="syncingSingle" :disabled="!canStartSingle" @click="startSingleSync">
                  {{ isLoggedIn ? '开始抓取并同步' : '下一步：登录后同步' }}
                </UButton>
              </div>

              <p v-if="singleError" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {{ singleError }}
              </p>
            </template>

            <template v-else>
              <div class="grid gap-4">
                <label class="grid gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm font-semibold text-slate-700">公众号清单</span>
                    <span class="text-xs text-slate-500">一行一个名称，系统会自动去重</span>
                  </div>
                  <textarea
                    v-model="batchInput"
                    rows="10"
                    class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="机器之心&#10;晚点LatePost&#10;张小珺"
                  />
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-semibold text-slate-700">保存的目录</span>
                  <UInput
                    v-model="storagePath"
                    size="xl"
                    :loading="loadingSettings || savingStorage"
                    placeholder="例如：D:\\知识库\\公众号"
                  />
                </label>

                <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input v-model="includeCover" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900" />
                  <span>
                    是否要抓取封面图片
                    <span class="block text-xs leading-6 text-slate-500">勾选后，每篇文章目录里会额外保存一张封面图片；不勾选则只抓正文文件。</span>
                  </span>
                </label>

                <div class="flex flex-wrap gap-3">
                  <UButton color="black" variant="soft" :loading="savingBatchAccounts" @click="saveBatchAccounts">
                    保存这批公众号为清单
                  </UButton>
                  <UButton
                    variant="soft"
                    color="gray"
                    :disabled="loadingBatchAccounts || savedBatchAccounts.length === 0"
                    @click="useSavedBatchAccounts"
                  >
                    载入已保存清单
                  </UButton>
                </div>

                <p class="text-xs text-slate-500">
                  推荐做法：把长期要维护的公众号保存成清单，以后只需要打开应用后点一次“开始批量抓取”。
                </p>
              </div>

              <div class="flex flex-wrap gap-3">
                <UButton color="black" size="xl" :loading="syncingBatch" :disabled="!canStartBatch" @click="startBatchSync()">
                  {{ isLoggedIn ? '开始批量抓取' : '下一步：登录后批量抓取' }}
                </UButton>
                <UButton
                  v-if="batchPausedForLogin && !syncingBatch"
                  size="xl"
                  variant="soft"
                  color="gray"
                  :disabled="!isLoggedIn"
                  @click="startBatchSync({ resume: true })"
                >
                  继续剩余任务
                </UButton>
              </div>

              <p v-if="batchError" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {{ batchError }}
              </p>
            </template>
          </div>

          <div class="flex flex-col justify-between gap-5 bg-slate-950 px-6 py-8 text-slate-50 sm:px-8 sm:py-10">
            <div class="grid gap-3">
              <div v-if="syncResult && mode === 'single'" class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
                <p class="text-sm text-emerald-200">本次结果</p>
                <p class="mt-2 text-lg font-semibold text-white">{{ syncResult.accountName }}</p>
                <p class="mt-2 text-sm text-emerald-100">模式：{{ syncResult.mode === 'incremental' ? '增量同步' : '首次抓取' }}</p>
                <p class="text-sm text-emerald-100">新增文章：{{ syncResult.newCount }}</p>
                <p class="text-sm text-emerald-100">总文章数：{{ syncResult.totalArticles }}</p>
              </div>
              <div v-else class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">本次结果</p>
                <p class="mt-2 text-lg font-semibold text-white">{{ mode === 'batch' ? '等待开始批量抓取' : '尚未开始同步' }}</p>
                <p class="mt-2 text-sm text-slate-300">
                  {{ mode === 'batch' ? `当前共 ${parsedBatchAccounts.length} 个公众号待处理。` : '开始后会在这里显示本次同步结果。' }}
                </p>
              </div>

              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">当前模式</p>
                <p class="mt-2 text-xl font-semibold">
                  {{ mode === 'single' ? '单个抓取' : '批量抓取' }}
                </p>
                <p class="mt-3 text-sm text-slate-300">
                  {{ mode === 'single' ? '输入一个公众号后立即同步。' : `当前清单 ${parsedBatchAccounts.length} 个公众号，按顺序依次抓取。` }}
                </p>
              </div>

              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">同步模式</p>
                <template v-if="mode === 'single'">
                  <p class="mt-2 text-xl font-semibold">
                    {{ inspectResult ? (inspectResult.mode === 'incremental' ? '检测到历史目录，将增量同步' : '未检测到历史目录，将首次抓取') : '尚未扫描' }}
                  </p>
                  <p v-if="inspectResult?.storagePath" class="mt-3 break-all text-sm text-slate-300">
                    {{ inspectResult.storagePath }}
                  </p>
                </template>
                <template v-else>
                  <p class="mt-2 text-xl font-semibold">
                    {{ batchSummary.success }}/{{ batchSummary.total || parsedBatchAccounts.length }} 已完成
                  </p>
                  <p class="mt-3 text-sm text-slate-300">
                    失败 {{ batchSummary.failed }}，等待 {{ batchSummary.pending }}，暂停登录 {{ batchSummary.authRequired }}
                  </p>
                </template>
              </div>

              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">流程说明</p>
                <p class="mt-2 text-sm leading-7 text-slate-200">1. 先设置保存目录</p>
                <p class="text-sm leading-7 text-slate-200">2. 选择单个抓取或批量抓取</p>
                <p class="text-sm leading-7 text-slate-200">3. 同步前自动检查登录状态，过期时要求重新扫码</p>
                <p class="text-sm leading-7 text-slate-200">4. 已存在的公众号默认走增量同步，只抓最新文章</p>
              </div>

              <div class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">登录状态</p>
                <p class="mt-2 text-xl font-semibold">
                  {{ isLoggedIn ? `已登录：${loginAccount?.nickname || '公众号平台'}` : '未登录，开始同步时会弹出二维码' }}
                </p>
              </div>

              <div v-if="mode === 'batch' && batchResults.length" class="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="text-sm text-slate-300">批量结果</p>
                <div class="mt-3 grid max-h-[340px] gap-3 overflow-auto pr-1">
                  <div
                    v-for="item in batchResults"
                    :key="item.accountName"
                    class="rounded-2xl border px-4 py-3 text-sm"
                    :class="getBatchStatusTone(item.status)"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <p class="font-semibold">{{ item.accountName }}</p>
                      <span class="whitespace-nowrap text-xs">{{ getBatchStatusLabel(item.status) }}</span>
                    </div>
                    <p class="mt-2 leading-6">{{ item.message }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
