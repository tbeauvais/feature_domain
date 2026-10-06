<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { pendingConfirm } from './confirm'

const answer = (confirmed: boolean) => pendingConfirm.value?.resolve(confirmed)

// Closing the dialog (Escape, clicking outside) means "no". The action button also closes it, before its own click
// handler runs, so the "no" waits a microtask and the button's explicit answer wins.
const open = computed({
  get: () => pendingConfirm.value !== null,
  set: (value) => {
    if (!value) queueMicrotask(() => answer(false))
  },
})
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent v-if="pendingConfirm" data-testid="confirm-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ pendingConfirm.title }}</AlertDialogTitle>
        <AlertDialogDescription class="whitespace-pre-line">{{ pendingConfirm.description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="confirm-cancel" @click="answer(false)">Cancel</AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-ok"
          :variant="pendingConfirm.destructive ? 'destructive' : 'default'"
          @click="answer(true)"
        >
          {{ pendingConfirm.confirmLabel }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
