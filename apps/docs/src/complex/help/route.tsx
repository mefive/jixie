import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ComplexRoute } from '@src/components/complex-route';
import helpEntry from '.';

export function Component() {
  const { '*': slug = '' } = useParams();
  const setupParams = useMemo(() => ({ slug }), [slug]);

  return <ComplexRoute entry={helpEntry} setupParams={setupParams} />;
}
