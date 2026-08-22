import { ref, computed } from 'vue';
import zhCN from '../locales/zh-CN';
import enUS from '../locales/en-US';

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const getPreferredLanguage = () => {
  const saved = localStorage.getItem('uptime_lang');
  if (saved && messages[saved]) return saved;
  const navLang = navigator.language || navigator.userLanguage || '';
  if (navLang.startsWith('zh')) return 'zh-CN';
  return 'en-US';
};

const currentLocale = ref(getPreferredLanguage());

export function useI18n() {
  const setLocale = (lang) => {
    if (messages[lang]) {
      currentLocale.value = lang;
      localStorage.setItem('uptime_lang', lang);
    }
  };

  const toggleLocale = () => {
    setLocale(currentLocale.value === 'zh-CN' ? 'en-US' : 'zh-CN');
  };

  const t = (path) => {
    const keys = path.split('.');
    let res = messages[currentLocale.value];
    for (const k of keys) {
      if (res && res[k] !== undefined) res = res[k];
      else return path;
    }
    return res;
  };

  return {
    locale: computed(() => currentLocale.value),
    setLocale,
    toggleLocale,
    t,
  };
}
