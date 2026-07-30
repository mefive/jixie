import { Navigate, createBrowserRouter } from 'react-router-dom';

export const router = createBrowserRouter(
  [
    {
      index: true,
      element: <Navigate to="/help" replace />,
    },
    {
      path: 'help/*',
      lazy: () => import('@src/complex/help/route'),
    },
    {
      path: 'sdk',
      lazy: () => import('@src/complex/sdk/route'),
    },
    {
      path: '*',
      element: <Navigate to="/help" replace />,
    },
  ],
  { basename: '/docs' },
);
