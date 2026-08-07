import { describe, it, expect } from 'vitest';
import {
  calculateBenchmarkStats,
  evaluateColdFirstPageLoad,
  evaluateCachedPageNavigation,
  evaluateFullTextSearchLatency,
  evaluateWorkingSetMemory,
  evaluateJobCancellationIntegrity,
  evaluateConcurrentReadingResponsiveness,
  formatPerformanceGateMarkdown,
  runR1PerformanceGateProbe,
  R1PerformanceGateReport,
} from './r1PerformanceGate';
import { JobQueueManager, createBackgroundJob } from './jobQueue';

describe('R1 Performance & Usability Gate Suite (PRD §17.2, §17.5)', () => {
  it('calculates benchmark median and worst statistics correctly', () => {
    const samples = [120, 45, 300, 80, 150];
    const stats = calculateBenchmarkStats(samples);
    expect(stats.median).toBe(120);
    expect(stats.worst).toBe(300);

    const evenSamples = [10, 20, 30, 40];
    const evenStats = calculateBenchmarkStats(evenSamples);
    expect(evenStats.median).toBe(25);
    expect(evenStats.worst).toBe(40);

    const emptyStats = calculateBenchmarkStats([]);
    expect(emptyStats.median).toBe(0);
    expect(emptyStats.worst).toBe(0);
  });

  it('a) evaluates cold first page load time (< 2000 ms)', () => {
    const passResult = evaluateColdFirstPageLoad(450, 2000);
    expect(passResult.measuredValue).toBe(450);
    expect(passResult.passed).toBe(true);
    expect(passResult.unit).toBe('ms');

    const failResult = evaluateColdFirstPageLoad(2400, 2000);
    expect(failResult.measuredValue).toBe(2400);
    expect(failResult.passed).toBe(false);
  });

  it('b) evaluates cached page navigation response (< 100 ms)', () => {
    const navSamples = [1.2, 0.8, 2.5, 0.5, 1.1];
    const metric = evaluateCachedPageNavigation(navSamples, 100);
    expect(metric.passed).toBe(true);
    expect(metric.median).toBeLessThan(100);
    expect(metric.worst).toBeLessThan(100);
  });

  it('c) evaluates full-text search latency (< 300 ms)', () => {
    const mockPages = [
      { pageNumber: 1, text: 'The quick brown fox jumps over the lazy dog.' },
      { pageNumber: 2, text: 'Mereth Reader provides high-performance PDF viewing and local annotation.' },
      { pageNumber: 3, text: 'Full text search with FTS5 indexing operates efficiently across pages.' },
    ];

    const { metric, matches } = evaluateFullTextSearchLatency(mockPages, 'Mereth Reader', undefined, 300);
    expect(metric.passed).toBe(true);
    expect(metric.median).toBeLessThan(300);
    expect(matches.length).toBe(1);
    expect(matches[0].pageNumber).toBe(2);
  });

  it('d) evaluates working-set memory usage during long scrolling (< 250 MB)', () => {
    const memoryMetric = evaluateWorkingSetMemory(5, 0.8, 45, 250);
    expect(memoryMetric.passed).toBe(true);
    expect(memoryMetric.measuredValue).toBe(49);
    expect(memoryMetric.measuredValue).toBeLessThan(250);

    const heavyMemoryMetric = evaluateWorkingSetMemory(500, 1.0, 50, 250);
    expect(heavyMemoryMetric.passed).toBe(false);
    expect(heavyMemoryMetric.measuredValue).toBe(550);
  });

  it('e) evaluates background job cancellation integrity without database/state corruption', () => {
    const job = createBackgroundJob({
      document_id: 'doc-cancel-test',
      job_type: 'text_extraction',
      total_pages: 400,
      active_page: 1,
    });

    const { metric, cancelledJob } = evaluateJobCancellationIntegrity(job, 'User aborted task');
    expect(metric.passed).toBe(true);
    expect(cancelledJob.status).toBe('cancelled');
    expect(cancelledJob.error).toBe('User aborted task');
    expect(cancelledJob.document_id).toBe('doc-cancel-test');
    expect(cancelledJob.total_pages).toBe(400);
  });

  it('f) evaluates concurrent reading responsiveness while background extraction/indexing runs', () => {
    const queueManager = new JobQueueManager();
    const simulatedLatencies = [0.8, 1.2, 0.5, 0.9, 1.1];

    const metric = evaluateConcurrentReadingResponsiveness(queueManager, simulatedLatencies, 100);
    expect(metric.passed).toBe(true);
    expect(metric.median).toBeLessThan(100);
  });

  it('formats R1 performance gate markdown report document correctly', () => {
    const sampleReport: R1PerformanceGateReport = {
      timestamp: '2026-08-06T06:30:00Z',
      hardware: {
        arch: 'x64',
        platform: 'linux',
        cpuModel: 'Intel Core i7-1185G7',
        cpuCores: 8,
        totalMemoryMb: 16384,
      },
      corpusVersion: '1.0.0 (15 canonical documents)',
      coldWarmState: 'Cold first page load; warm cached page navigation and FTS queries',
      measurementMethodology: 'Automated measurement harness',
      metrics: {
        coldFirstPageLoad: evaluateColdFirstPageLoad(185, 2000),
        cachedPageNavigation: evaluateCachedPageNavigation([0.15, 0.20], 100),
        fullTextSearchLatency: evaluateFullTextSearchLatency(
          [{ pageNumber: 1, text: 'Sample PDF search text' }],
          'search',
          undefined,
          300
        ).metric,
        workingSetMemory: evaluateWorkingSetMemory(5, 0.8, 45, 250),
        jobCancellation: evaluateJobCancellationIntegrity(
          createBackgroundJob({ document_id: 'doc-1', job_type: 'fts_indexing', total_pages: 100 })
        ).metric,
        concurrentReadingResponsiveness: evaluateConcurrentReadingResponsiveness(
          new JobQueueManager(),
          [0.2, 0.3],
          100
        ),
      },
      allGatesPassed: true,
    };

    const markdown = formatPerformanceGateMarkdown(sampleReport);
    expect(markdown).toContain('# R1 Performance & Usability Gate Report (PRD §17.2, §17.5)');
    expect(markdown).toContain('PASSED ✅');
    expect(markdown).toContain('Cold First Page Load Time');
    expect(markdown).toContain('Cached Page Navigation Response');
    expect(markdown).toContain('Full-Text Search Latency');
    expect(markdown).toContain('Working-Set Memory Usage');
    expect(markdown).toContain('Job Cancellation Integrity');
    expect(markdown).toContain('Concurrent Reading Responsiveness');
  });

  it('executes full Node probe scripts/r1_performance_gate_probe.mjs and validates all corpus metrics pass', () => {
    const report = runR1PerformanceGateProbe();
    expect(report).toBeDefined();
    expect(report.hardware).toBeDefined();
    expect(report.allGatesPassed).toBe(true);

    expect(report.metrics.coldFirstPageLoad.passed).toBe(true);
    expect(report.metrics.coldFirstPageLoad.median).toBeLessThan(2000);

    expect(report.metrics.cachedPageNavigation.passed).toBe(true);
    expect(report.metrics.cachedPageNavigation.median).toBeLessThan(100);

    expect(report.metrics.fullTextSearchLatency.passed).toBe(true);
    expect(report.metrics.fullTextSearchLatency.median).toBeLessThan(300);

    expect(report.metrics.workingSetMemory.passed).toBe(true);
    expect(report.metrics.workingSetMemory.median).toBeLessThan(250);

    expect(report.metrics.jobCancellation.passed).toBe(true);

    expect(report.metrics.concurrentReadingResponsiveness.passed).toBe(true);
    expect(report.metrics.concurrentReadingResponsiveness.median).toBeLessThan(100);
  }, 30000);
});
