<template>
  <OpsBoardShell />
</template>

<script setup>
// 獨立全屏看板：不套用後台 layout，深色雷池風格由 Shell 自帶。
definePageMeta({
  layout: false,
  middleware: ['ops-board']
})

useHead({
  title: '运维数据看板',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  bodyAttrs: { style: 'background:#0b1020;margin:0' }
})
</script>
