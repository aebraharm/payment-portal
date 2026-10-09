import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvoiceStatusBadge, ConfirmationStatusBadge } from '../../src/components/ui/Badge';
import { Stepper } from '../../src/components/ui/Stepper';
import { CopyField } from '../../src/components/ui/CopyField';
import { FileUpload } from '../../src/components/ui/FileUpload';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Tabs } from '../../src/components/ui/Tabs';
import { IconCheck } from '../../src/components/ui/Icons';

describe('InvoiceStatusBadge', () => {
  it('renders human-readable labels for every invoice status', () => {
    const cases: Array<[string, string]> = [
      ['draft', 'Draft'],
      ['unpaid', 'Unpaid'],
      ['awaiting_payment', 'Awaiting payment'],
      ['confirmation_submitted', 'Confirmation submitted'],
      ['under_review', 'Under review'],
      ['paid', 'Payment verified'],
      ['partially_paid', 'Partially paid'],
      ['rejected', 'Rejected'],
      ['refunded', 'Refunded'],
      ['cancelled', 'Cancelled'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<InvoiceStatusBadge status={status as never} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('ConfirmationStatusBadge', () => {
  it('renders labels for confirmation statuses', () => {
    const cases: Array<[string, string]> = [
      ['submitted', 'Awaiting verification'],
      ['under_review', 'Under review'],
      ['verified', 'Payment verified'],
      ['rejected', 'Rejected'],
      ['info_requested', 'More information needed'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<ConfirmationStatusBadge status={status as never} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Stepper', () => {
  it('marks the current step and announces it', () => {
    render(
      <Stepper
        current={1}
        steps={[{ label: 'Select invoice' }, { label: 'Payment details' }, { label: 'Submit proof' }]}
      />
    );
    expect(screen.getByText('Select invoice')).toBeInTheDocument();
    expect(screen.getByText('Payment details')).toBeInTheDocument();
    expect(screen.getByText('Submit proof')).toBeInTheDocument();
    expect(screen.getByText('Payment details').closest('li')?.querySelector('[aria-current="step"]')).not.toBeNull();
  });
});

describe('CopyField', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('copies the value to the clipboard and confirms visually', async () => {
    const { container } = render(<CopyField label="Access code" value="ABC123XYZ" />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123XYZ');
    });
    // The copy icon is replaced by a check icon to confirm the copy.
    await waitFor(() => {
      expect(container.querySelector('path[d="M4 12.5l5 5L20 6.5"]')).not.toBeNull();
    });
  });
});

describe('FileUpload', () => {
  it('accepts a valid file within the size limit', () => {
    const onChange = vi.fn();
    render(<FileUpload accept=".pdf,image/*" maxSizeMb={1} onChange={onChange} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array(1024)], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it('rejects an oversized file', () => {
    const onChange = vi.fn();
    render(<FileUpload maxSizeMb={1} onChange={onChange} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByText('File is larger than 1 MB.')).toBeInTheDocument();
  });

  it('rejects a disallowed file type', () => {
    const onChange = vi.fn();
    render(<FileUpload accept=".pdf,image/*" onChange={onChange} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const exe = new File([new Uint8Array(10)], 'virus.exe', { type: 'application/x-msdownload' });
    fireEvent.change(input, { target: { files: [exe] } });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByText(/File type not allowed/)).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState icon={<IconCheck />} title="Nothing here" description="Come back later" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Come back later')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('switches the active tab on click', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState('a');
      return (
        <div>
          <Tabs
            tabs={[
              { id: 'a', label: 'Alpha' },
              { id: 'b', label: 'Beta' },
            ]}
            active={active}
            onChange={setActive}
          />
          <p>{active === 'a' ? 'Alpha content' : 'Beta content'}</p>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Alpha content')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByText('Beta content')).toBeInTheDocument();
    expect(screen.queryByText('Alpha content')).not.toBeInTheDocument();
  });
});
