import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, ConfirmModal } from '../../src/components/ui/Modal';

/**
 * Regression tests for the modal focus bug.
 *
 * Every caller passes an INLINE onClose arrow function, so its identity changed
 * on every render. The modal's open effect was keyed by [open, onClose], so each
 * keystroke in a modal form re-ran the effect and called dialogRef.focus(),
 * moving focus off the field. In "New client" that meant the name input lost
 * focus after a single character and the admin had to click it again.
 *
 * These tests type multi-character values continuously and assert that focus
 * stays put, while pinning the behaviour the effect is still responsible for:
 * Escape-to-close, scroll-lock cleanup, initial focus and focus restoration.
 */

/** Mirrors CreateClientModal in AdminClients.tsx: local form state + inline onClose. */
function ClientFormHarness({ onCloseSpy = vi.fn() }: { onCloseSpy?: () => void } = {}) {
  const [open, setOpen] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const reset = () => {
    setFullName('');
    setEmail('');
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open modal</button>
      <Modal
        open={open}
        onClose={() => {
          reset();
          setOpen(false);
          onCloseSpy();
        }}
        title="New client"
        description="The client signs in with their full name and a one-time access code."
        footer={<button onClick={() => setOpen(false)}>Cancel</button>}
      >
        <form>
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <output data-testid="fullNameValue">{fullName}</output>
        </form>
      </Modal>
    </>
  );
}

describe('Modal focus while typing', () => {
  it('keeps focus in the name input across a multi-character value', async () => {
    const user = userEvent.setup();
    render(<ClientFormHarness />);

    const input = screen.getByLabelText('Full name') as HTMLInputElement;
    await user.click(input);
    expect(input).toHaveFocus();

    await user.type(input, 'Amara Okafor');

    // Every character reached the field, and focus never left it.
    expect(input).toHaveValue('Amara Okafor');
    expect(screen.getByTestId('fullNameValue')).toHaveTextContent('Amara Okafor');
    expect(input).toHaveFocus();
  });

  it('retains focus after each individual keystroke', async () => {
    const user = userEvent.setup();
    render(<ClientFormHarness />);

    const input = screen.getByLabelText('Full name') as HTMLInputElement;
    await user.click(input);

    const name = 'Chidinma Balogun';
    for (let i = 0; i < name.length; i += 1) {
      await user.keyboard(name[i]);
      expect(document.activeElement, `focus lost after typing "${name.slice(0, i + 1)}"`).toBe(input);
      expect(input.value).toBe(name.slice(0, i + 1));
    }
    expect(input).toHaveValue(name);
  });

  it('moves between fields without losing focus to the dialog', async () => {
    const user = userEvent.setup();
    render(<ClientFormHarness />);

    const name = screen.getByLabelText('Full name');
    const email = screen.getByLabelText('Email');

    await user.type(name, 'Tunde Adeyemi');
    await user.type(email, 'tunde@example.com');
    // Typing in the second field did not disturb the first.
    await user.type(name, ' Jr');

    expect(name).toHaveValue('Tunde Adeyemi Jr');
    expect(email).toHaveValue('tunde@example.com');
    expect(name).toHaveFocus();
  });

  it('does not steal focus when the parent re-renders with a new inline onClose', async () => {
    const user = userEvent.setup();

    function RerenderingParent() {
      const [, setTick] = useState(0);
      const [value, setValue] = useState('');
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>Force re-render</button>
          <Modal open onClose={() => setTick((t) => t + 1)} title="Re-render probe">
            <label htmlFor="probe">Value</label>
            <input id="probe" value={value} onChange={(e) => setValue(e.target.value)} />
          </Modal>
        </>
      );
    }

    render(<RerenderingParent />);
    const input = screen.getByLabelText('Value') as HTMLInputElement;
    await user.type(input, 'abc');

    // A parent re-render creates a brand-new onClose identity mid-typing.
    await user.click(screen.getByRole('button', { name: 'Force re-render' }));
    await user.click(input);
    await user.type(input, 'def');

    expect(input).toHaveValue('abcdef');
    expect(input).toHaveFocus();
  });
});

describe('Modal open/close behaviour is preserved', () => {
  it('focuses the dialog when it opens', () => {
    render(<ClientFormHarness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('New client');
    // role="dialog" is on the wrapper; the focusable panel is inside it.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('closes on Escape and calls onClose exactly once', async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();
    render(<ClientFormHarness onCloseSpy={onCloseSpy} />);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('closes on the close button and on backdrop click', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ClientFormHarness />);
    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    render(<ClientFormHarness />);
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.firstElementChild as HTMLElement;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores focus to the element that opened the dialog', async () => {
    const user = userEvent.setup();

    function OpenCloseHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Add client</button>
          <Modal open={open} onClose={() => setOpen(false)} title="New client">
            <p>Body</p>
          </Modal>
        </>
      );
    }

    render(<OpenCloseHarness />);
    const trigger = screen.getByRole('button', { name: 'Add client' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore focus to an element that has since been removed', async () => {
    const user = userEvent.setup();

    function DisappearingTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {open && <button onClick={() => setOpen(true)}>Temporary trigger</button>}
          {!open && <button onClick={() => setOpen(true)}>Add client</button>}
          <Modal open={open} onClose={() => setOpen(false)} title="New client">
            <p>Body</p>
          </Modal>
        </>
      );
    }

    render(<DisappearingTrigger />);
    await user.click(screen.getByRole('button', { name: 'Add client' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // No crash, and focus is never left on a detached node.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.contains(document.activeElement)).toBe(true);
  });

  it('locks body scroll while open and cleans it up on close', async () => {
    const user = userEvent.setup();
    render(<ClientFormHarness />);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('cleans up scroll lock and listeners when unmounted while open', () => {
    const { unmount } = render(<ClientFormHarness />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('does not focus or lock scroll when rendered closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Hidden">
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('uses the latest onClose even though the effect does not re-run', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();

    function ChangingCallback() {
      const [phase, setPhase] = useState<'first' | 'second'>('first');
      const onClose = phase === 'first' ? first : second;
      return (
        <>
          <button onClick={() => setPhase('second')}>Switch callback</button>
          <Modal open onClose={onClose} title="Callback probe">
            <p>Body</p>
          </Modal>
        </>
      );
    }

    render(<ChangingCallback />);
    await user.click(screen.getByRole('button', { name: 'Switch callback' }));
    await user.keyboard('{Escape}');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmModal', () => {
  it('renders the confirmation and invokes onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Reset access code?"
        description="All sessions are revoked."
        confirmLabel="Reset"
        cancelLabel="Keep it"
        tone="danger"
      />
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Reset access code?');
    expect(screen.getByText('All sessions are revoked.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape through the inline onClose chain', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmModal open onClose={() => onClose()} onConfirm={vi.fn()} title="Confirm?" />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog usable while loading', () => {
    render(
      <ConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} title="Verify?" loading confirmLabel="Verify" />
    );
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
  });
});

describe('Modal does not leak global listeners', () => {
  it('removes the keydown listener after closing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ClientFormHarness onCloseSpy={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    // A later Escape must not fire the closed modal's handler again.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
