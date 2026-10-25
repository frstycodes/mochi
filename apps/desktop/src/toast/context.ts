import { createContext, useContext } from 'react';

/** The toast a widget is open in, so a decision made there turns that same toast into its outcome. Null outside one. */
export const ToastIdContext = createContext<string | null>(null);

export const useContainingToastId = () => useContext(ToastIdContext);
