/**
 * What the app tells the guided tour: the moments it cannot see from the
 * page's address or elements alone (a letter is being read, sending failed,
 * the patient's reply was answered). Sent as a window event, so a component
 * says it without knowing whether a tour is running.
 */

export type TourSignal =
  | 'intake:reading'   // a discharge letter went in and is being read
  | 'intake:read'      // …and its details are on screen
  | 'intake:failed'    // …or it could not be read
  | 'intake:saved'     // the patient was added (detail: 'own' or 'demo', the WhatsApp number used)
  | 'careplan:confirm' // "Approve and send" asked who gets what
  | 'careplan:sent'    // the care plan went out
  | 'careplan:failed'  // …or it did not (detail: why)
  | 'patient:replied'  // a demo reply was written as the patient
  | 'patient:failed'   // …but could not be sent
  | 'patient:answered' // the assistant answered it
  | 'patient:alerted'  // it raised an alert for the nurses

export const TOUR_SIGNAL_EVENT = 'careloop:tour-signal'

export interface TourSignalDetail {
  signal: TourSignal
  detail?: string
}

export function signalTour(signal: TourSignal, detail?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TourSignalDetail>(TOUR_SIGNAL_EVENT, { detail: { signal, detail } }))
}
