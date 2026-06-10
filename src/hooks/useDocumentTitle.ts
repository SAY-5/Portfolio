import { useEffect } from 'react';

const BASE = 'Sai Asish Y';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} / ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [title]);
}
