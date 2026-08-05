import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DialogHost, type AlertRequest, type ConfirmRequest, type DialogRequest, type PromptRequest } from './Dialog'

interface Dialogs {
  prompt(opts: Omit<PromptRequest, 'kind' | 'resolve'>): Promise<string | null>
  confirm(opts: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean>
  /** One OK, no question asked — resolves when dismissed, however dismissed. */
  alert(opts: Omit<AlertRequest, 'kind' | 'resolve'>): Promise<void>
}

const noop: Dialogs = {
  prompt: async () => null,
  confirm: async () => false,
  alert: async () => {},
}

const DialogContext = createContext<Dialogs>(noop)
export const useDialogs = () => useContext(DialogContext)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null)

  const prompt = useCallback<Dialogs['prompt']>(
    (opts) =>
      new Promise((resolve) => {
        setRequest({
          ...opts,
          kind: 'prompt',
          resolve: (v) => {
            setRequest(null)
            resolve(v)
          },
        })
      }),
    [],
  )

  const confirm = useCallback<Dialogs['confirm']>(
    (opts) =>
      new Promise((resolve) => {
        setRequest({
          ...opts,
          kind: 'confirm',
          resolve: (v) => {
            setRequest(null)
            resolve(v)
          },
        })
      }),
    [],
  )

  const alert = useCallback<Dialogs['alert']>(
    (opts) =>
      new Promise((resolve) => {
        setRequest({
          ...opts,
          kind: 'alert',
          resolve: () => {
            setRequest(null)
            resolve()
          },
        })
      }),
    [],
  )

  const value = useMemo(() => ({ prompt, confirm, alert }), [prompt, confirm, alert])

  return (
    <DialogContext.Provider value={value}>
      {children}
      <DialogHost request={request} />
    </DialogContext.Provider>
  )
}
