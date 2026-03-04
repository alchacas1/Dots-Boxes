import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

jest.mock('./contexts/SocketContext', () => {
  const dummySocket = {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  };

  return {
    __esModule: true,
    useSocket: () => dummySocket,
    SocketProvider: ({ children }) => children,
  };
});

test('renders lobby game selector', () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByText(/Elige un juego/i)).toBeInTheDocument();
});
