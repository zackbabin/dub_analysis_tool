// Fixed Data Merger with Mixpanel Sync Integration - Inline Version
function createInlineDataMerger(targetContainer) {
  targetContainer.innerHTML = '';
  
  // Create wrapper with consistent styling
  const wrapper = document.createElement('div');
  wrapper.className = 'qda-inline-widget';
  
  // Header - UPDATED TITLE
  const header = document.createElement('div');
  header.className = 'qda-header';
  
  const title = document.createElement('h3');
  title.textContent = 'Data Merge Tool'; // Updated from "Comprehensive CSV Processor"
  title.style.margin = '0';
  header.appendChild(title);
  
  // Content area
  const content = document.createElement('div');
  content.className = 'qda-content';
  
  // File upload section - matching the analysis tool structure exactly
  const uploadSection = document.createElement('div');
  uploadSection.className = 'qda-upload-section';
  
  const uploadColumn = document.createElement('div');
  uploadColumn.className = 'qda-upload-column';
  
  const uploadLabel = document.createElement('div');
  uploadLabel.className = 'qda-file-label';
  uploadLabel.textContent = 'Select All 7 Raw CSV Files';
  uploadColumn.appendChild(uploadLabel);
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  fileInput.multiple = true;
  fileInput.className = 'qda-file-input';
  uploadColumn.appendChild(fileInput);
  
  uploadSection.appendChild(uploadColumn);
  
  // Button row with both Merge and Sync buttons
  const analyzeRow = document.createElement('div');
  analyzeRow.className = 'qda-analyze-row';
  analyzeRow.style.display = 'flex';
  analyzeRow.style.justifyContent = 'center';
  analyzeRow.style.gap = '10px';
  
  // Original Merge Files button
  const processBtn = document.createElement('button');
  processBtn.className = 'qda-btn';
  processBtn.textContent = 'Merge Files';
  
  processBtn.onclick = async () => {
    
    // Clear old summary text/status when starting new merge
    const oldSummary = content.querySelector('.data-merger-summary');
    if (oldSummary) oldSummary.remove();

    const files = Array.from(fileInput.files);
    if (files.length !== 7) {
      alert(`Please select exactly 7 CSV files. You selected ${files.length} files.`);
      return;
    }
    
    try {
      processBtn.textContent = 'Processing...';
      processBtn.disabled = true;

      console.log('Intelligently identifying file types...');
      const matchedFiles = await matchFilesByName(files);
    
      if (!matchedFiles.success) {
          const missingTypes = [];
          if (!matchedFiles.files[0]) missingTypes.push('Demo/breakdown file');
          if (!matchedFiles.files[1]) missingTypes.push('Time to first copy file'); 
          if (!matchedFiles.files[2]) missingTypes.push('Time to funded account file');
          if (!matchedFiles.files[3]) missingTypes.push('Time to linked bank file');
          if (!matchedFiles.files[4]) missingTypes.push('Premium subscription file');
          if (!matchedFiles.files[5]) missingTypes.push('Creator-level copy file');
          if (!matchedFiles.files[6]) missingTypes.push('Portfolio-level copy file');
          
          throw new Error(`Could not identify ${7 - matchedFiles.foundCount} file types. Missing: ${missingTypes.join(', ')}. Please check that your files contain the expected column structures.`);
      }
    
      console.log('Reading all files...');
      const contents = await Promise.all(matchedFiles.files.map(file => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file: ' + file.name));
            reader.readAsText(file);
          });
      }));
      
      console.log('Processing comprehensive merge...');
      const results = processComprehensiveData(contents);

      createMultipleDownloads(results);
      
      processBtn.textContent = 'Success! Check downloads';
      processBtn.style.background = '#28a745';
      
      // Reset button after 3 seconds
      setTimeout(() => {
        processBtn.textContent = 'Merge Files';
        processBtn.style.background = '#17a2b8';
        processBtn.disabled = false;
      }, 3000);
      
    } catch (error) {
      console.error('Error:', error);
      alert('Error: ' + error.message);
      processBtn.textContent = 'Merge Files';
      processBtn.style.background = '#17a2b8';
      processBtn.disabled = false;
    }
  };
  
  // NEW: Sync Mixpanel Data button
  const syncBtn = document.createElement('button');
  syncBtn.className = 'qda-btn';
  syncBtn.textContent = 'Sync Mixpanel Data';
  syncBtn.style.background = '#6f42c1'; // Purple to differentiate
  
  syncBtn.onclick = async () => {
    // Check if MixpanelSync is available
    if (typeof window.MixpanelSync === 'undefined') {
      alert('Mixpanel Sync module not loaded. Please ensure mixpanel_sync.js is included.');
      return;
    }
    
    const mixpanelSync = new window.MixpanelSync();
    
    // Check for credentials
    if (!mixpanelSync.hasCredentials()) {
      // Show credentials modal
      if (typeof window.showCredentialsModal === 'function') {
        window.showCredentialsModal();
      } else {
        alert('Please configure Mixpanel credentials first.');
      }
      return;
    }
    
    try {
      syncBtn.textContent = 'Syncing...';
      syncBtn.disabled = true;
      processBtn.disabled = true; // Disable merge button during sync
      
      // Clear old summary text/status when starting new sync
      const oldSummary = content.querySelector('.data-merger-summary');
      if (oldSummary) oldSummary.remove();
      
      console.log('Fetching data from Mixpanel...');
      
      // Fetch all chart data from Mixpanel
      const csvDataArray = await mixpanelSync.fetchAllChartData();
      
      console.log('Processing synced data...');
      
      // Process the CSV data using existing function
      const results = processComprehensiveData(csvDataArray);
      
      // Create downloads
      createMultipleDownloads(results);
      
      syncBtn.textContent = 'Sync Success!';
      syncBtn.style.background = '#28a745';
      
      // Add summary message
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'data-merger-summary';
      summaryDiv.style.cssText = 'margin-top: 15px; padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724; text-align: center;';
      summaryDiv.textContent = 'Data synced successfully! Check your downloads.';
      content.appendChild(summaryDiv);
      
      // Reset button after 3 seconds
      setTimeout(() => {
        syncBtn.textContent = 'Sync Mixpanel Data';
        syncBtn.style.background = '#6f42c1';
        syncBtn.disabled = false;
        processBtn.disabled = false;
      }, 3000);
      
    } catch (error) {
      console.error('Sync error:', error);
      
      if (error.message.includes('credentials')) {
        if (typeof window.showCredentialsModal === 'function') {
          window.showCredentialsModal();
        } else {
          alert('Please configure valid Mixpanel credentials.');
        }
      } else {
        alert('Sync failed: ' + error.message);
      }
      
      syncBtn.textContent = 'Sync Mixpanel Data';
      syncBtn.style.background = '#6f42c1';
      syncBtn.disabled = false;
      processBtn.disabled = false;
    }
  };

  analyzeRow.appendChild(processBtn);
  analyzeRow.appendChild(syncBtn);
  
  // Add credentials status indicator
  const credentialsStatus = document.createElement('div');
  credentialsStatus.id = 'credentialsStatus';
  credentialsStatus.style.cssText = 'margin-top: 10px; text-align: center; font-size: 12px;';
  
  // Check and display credentials status
  if (typeof window.MixpanelSync !== 'undefined') {
    const mixpanelSync = new window.MixpanelSync();
    if (mixpanelSync.hasCredentials()) {
      credentialsStatus.innerHTML = `
        <span style="color: #28a745;">✓ Mixpanel credentials configured</span>
        <button onclick="window.showCredentialsModal()" style="margin-left: 10px; padding: 2px 8px; font-size: 11px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer;">Update</button>
      `;
    } else {
      credentialsStatus.innerHTML = `
        <span style="color: #dc3545;">✗ Mixpanel credentials not configured</span>
        <button onclick="window.showCredentialsModal()" style="margin-left: 10px; padding: 2px 8px; font-size: 11px; background: #6f42c1; color: white; border: none; border-radius: 3px; cursor: pointer;">Configure</button>
      `;
    }
  }
  
  // Assemble the sections in the right order
  content.appendChild(header);
  content.appendChild(uploadSection);
  content.appendChild(analyzeRow);
  content.appendChild(credentialsStatus);
  
  wrapper.appendChild(content);
  targetContainer.appendChild(wrapper);
}

// Keep original function for backwards compatibility
function createComprehensiveCSVProcessor() {
  // ... (omitted for brevity - keep existing implementation)
}

async function matchFilesByName(files) {
  const requiredFiles = {
    demo: null,
    firstCopy: null,
    fundedAccount: null,
    linkedBank: null,
    premiumSub: null,
    creatorCopy: null,
    portfolioCopy: null
  };
  
  console.log('Analyzing file structures to identify file types...');
  
  // Read first few lines of each file to analyze structure
  const fileAnalyses = await Promise.all(files.map(async file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        const lines = content.split('\n').slice(0, 3); // First 3 lines
        const headers = lines[0] ? lines[0].split(',').map(h => h.trim().replace(/"/g, '')) : [];
        
        resolve({
          file: file,
          headers: headers,
          headerString: headers.join('|').toLowerCase(),
          filename: file.name.toLowerCase()
        });
      };
      reader.readAsText(file);
    });
  }));
  
  // Smart matching based on file content structure
  fileAnalyses.forEach(analysis => {
    const { file, headers, headerString, filename } = analysis;
    
    console.log(`Analyzing ${file.name}:`, headers);
    
    // Demo breakdown file: has income, netWorth, and multiple demographic columns
    // UPDATED: Now also checks for the new subscribers insights columns including Creator Card Taps and Portfolio Card Taps
    if (headerString.includes('income') && headerString.includes('networth') && 
        (headerString.includes('total deposits') || headerString.includes('b. total deposits')) && 
        (headerString.includes('total subscriptions') || headerString.includes('m. total subscriptions') || 
         headerString.includes('d. subscribed within 7 days')) &&
        (headerString.includes('s. creator card taps') || headerString.includes('t. portfolio card taps') || 
         headerString.includes('creator card taps') || headerString.includes('portfolio card taps'))) {
      if (!requiredFiles.demo) {
        requiredFiles.demo = file;
        console.log(`✓ Identified DEMO file: ${file.name}`);
      }
    }
    
    // Time files: have "Funnel" and "Distinct ID" with a date range column
    else if (headerString.includes('funnel') && headerString.includes('distinct id') && headers.length === 3) {
      // Distinguish between the three time files by filename keywords
      if ((filename.includes('first') && filename.includes('copy')) || 
          filename.includes('portfolio')) {
        if (!requiredFiles.firstCopy) {
          requiredFiles.firstCopy = file;
          console.log(`✓ Identified FIRST COPY time file: ${file.name}`);
        }
      }
      else if (filename.includes('fund') || filename.includes('deposit')) {
        if (!requiredFiles.fundedAccount) {
          requiredFiles.fundedAccount = file;
          console.log(`✓ Identified FUNDED ACCOUNT time file: ${file.name}`);
        }
      }
      else if (filename.includes('bank') || filename.includes('link')) {
        if (!requiredFiles.linkedBank) {
          requiredFiles.linkedBank = file;
          console.log(`✓ Identified LINKED BANK time file: ${file.name}`);
        }
      }
    }
    
    // Premium subscription: has creatorUsername and viewed creator paywall
    else if (headerString.includes('creatorusername') && 
             headerString.includes('viewed creator paywall') && 
             headerString.includes('viewed stripe modal')) {
      if (!requiredFiles.premiumSub) {
        requiredFiles.premiumSub = file;
        console.log(`✓ Identified PREMIUM SUBSCRIPTION file: ${file.name}`);
      }
    }
    
    // Creator copy: has creatorUsername and portfolio details columns (but NOT portfolioTicker)
    else if (headerString.includes('creatorusername') && 
             headerString.includes('viewed portfolio details') && 
             !headerString.includes('portfolioticker')) {
      if (!requiredFiles.creatorCopy) {
        requiredFiles.creatorCopy = file;
        console.log(`✓ Identified CREATOR COPY file: ${file.name}`);
      }
    }
    
    // Portfolio copy: has portfolioTicker and portfolio details columns  
    else if (headerString.includes('portfolioticker') && 
             headerString.includes('viewed portfolio details')) {
      if (!requiredFiles.portfolioCopy) {
        requiredFiles.portfolioCopy = file;
        console.log(`✓ Identified PORTFOLIO COPY file: ${file.name}`);
      }
    }
  });
  
  // Fallback: use filename patterns for any unidentified files
  const unidentifiedTypes = Object.keys(requiredFiles).filter(key => !requiredFiles[key]);
  
  if (unidentifiedTypes.length > 0) {
    console.log('Using filename fallback for:', unidentifiedTypes);
    
    const patterns = [
      { key: 'demo', pattern: /(demo|breakdown|subscriber)/i },
      { key: 'firstCopy', pattern: /(first.*copy|copy.*first|time.*copy)/i },
      { key: 'fundedAccount', pattern: /(fund|deposit|account)/i },
      { key: 'linkedBank', pattern: /(link|bank)/i },
      { key: 'premiumSub', pattern: /(premium|subscription|paywall)/i },
      { key: 'creatorCopy', pattern: /(creator.*copy|creatorlevel)/i },
      { key: 'portfolioCopy', pattern: /(portfolio.*copy|portfoliolevel)/i }
    ];
    
    fileAnalyses.forEach(analysis => {
      if (requiredFiles.demo && requiredFiles.firstCopy && requiredFiles.fundedAccount && 
          requiredFiles.linkedBank && requiredFiles.premiumSub && requiredFiles.creatorCopy && 
          requiredFiles.portfolioCopy) return;
          
      patterns.forEach(({ key, pattern }) => {
        if (!requiredFiles[key] && pattern.test(analysis.filename)) {
          requiredFiles[key] = analysis.file;
          console.log(`✓ Fallback matched ${key}: ${analysis.file.name}`);
        }
      });
    });
  }
  
  const allFilesFound = Object.values(requiredFiles).every(file => file !== null);
  const foundCount = Object.values(requiredFiles).filter(file => file !== null).length;
  
  return {
    success: allFilesFound,
    foundCount: foundCount,
    files: [
      requiredFiles.demo,
      requiredFiles.firstCopy,
      requiredFiles.fundedAccount,
      requiredFiles.linkedBank,
      requiredFiles.premiumSub,
      requiredFiles.creatorCopy,
      requiredFiles.portfolioCopy
    ]
  };
}

function processComprehensiveData(contents) {
  // Helper function to clean column names
  function cleanColumnName(name) {
    return name
      .replace(/^[A-Z]\.\s*/, '') // Remove "A. ", "B. " etc.
      .replace(/\s*\(\$?\)\s*/, '') // Remove empty parentheses like " ($)" or " ()"
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Add spaces in camelCase
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // Handle sequences like "ID" -> "I D"
      .replace(/\b\w/g, l => l.toUpperCase()) // Title case
      .replace(/\bI D\b/g, 'ID'); // Fix "I D" back to "ID"
  }
  
  // Helper function to clean data values
  function cleanValue(value) {
    if (value === 'undefined' || value === '$non_numeric_values' || value === null || value === undefined) {
      return '';
    }
    return value;
  }
  
  // Parse CSV function
  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((h, i) => row[h] = values[i] ? values[i].trim().replace(/"/g, '') : '');
      return row;
    });
    return { headers, data };
  }
  
  console.log('Parsing all CSV files...');
  const [
    demoData,
    firstCopyData, 
    fundedAccountData,
    linkedBankData,
    premiumSubData,
    creatorCopyData,
    portfolioCopyData
  ] = contents.map(parseCSV);
  
  console.log('Data loaded:', {
    demo: demoData.data.length,
    firstCopy: firstCopyData.data.length,
    fundedAccount: fundedAccountData.data.length,
    linkedBank: linkedBankData.data.length,
    premiumSub: premiumSubData.data.length,
    creatorCopy: creatorCopyData.data.length,
    portfolioCopy: portfolioCopyData.data.length
  });
  
  // Normalize distinct_id keys
  function normalizeId(row) {
    return row['Distinct ID'] || row['$distinct_id'];
  }
  
  // Create time mappings
  const timeToFirstCopyMap = {};
  const timeToDepositMap = {};
  const timeToLinkedBankMap = {};
  
  firstCopyData.data.forEach(row => {
    const id = normalizeId(row);
    if (id) timeToFirstCopyMap[id] = row[firstCopyData.headers[2]];
  });
  
  fundedAccountData.data.forEach(row => {
    const id = normalizeId(row);
    if (id) timeToDepositMap[id] = row[fundedAccountData.headers[2]];
  });
  
  linkedBankData.data.forEach(row => {
    const id = normalizeId(row);
    if (id) timeToLinkedBankMap[id] = row[linkedBankData.headers[2]];
  });
  
  // Create aggregated conversion metrics by distinct_id
  const conversionAggregates = {};
  
  // Process premium subscription data
  premiumSubData.data.forEach(row => {
    const id = normalizeId(row);
    if (!id) return;
    
    if (!conversionAggregates[id]) {
      conversionAggregates[id] = {
        total_paywall_views: 0,
        total_stripe_views: 0, 
        total_subscriptions: 0,
        total_creator_portfolio_views: 0,
        total_creator_copy_starts: 0,
        total_creator_copies: 0,
        unique_creators_interacted: new Set()
      };
    }
    
    conversionAggregates[id].total_paywall_views += parseInt(row['(1) Viewed Creator Paywall'] || 0);
    conversionAggregates[id].total_stripe_views += parseInt(row['(2) Viewed Stripe Modal'] || 0);
    conversionAggregates[id].total_subscriptions += parseInt(row['(3) Subscribed to Creator'] || 0);
    if (row['creatorUsername']) {
      conversionAggregates[id].unique_creators_interacted.add(row['creatorUsername']);
    }
  });
  
  // Process creator-level copy data
  creatorCopyData.data.forEach(row => {
    const id = normalizeId(row);
    if (!id) return;
    
    if (!conversionAggregates[id]) {
      conversionAggregates[id] = {
        total_paywall_views: 0,
        total_stripe_views: 0,
        total_subscriptions: 0,
        total_creator_portfolio_views: 0,
        total_creator_copy_starts: 0,
        total_creator_copies: 0,
        unique_creators_interacted: new Set()
      };
    }
    
    conversionAggregates[id].total_creator_portfolio_views += parseInt(row['(1) Viewed Portfolio Details'] || 0);
    conversionAggregates[id].total_creator_copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
    conversionAggregates[id].total_creator_copies += parseInt(row['(3) Copied Portfolio'] || 0);
    if (row['creatorUsername']) {
      conversionAggregates[id].unique_creators_interacted.add(row['creatorUsername']);
    }
  });
  
  // Aggregate portfolio-level data and combine with creator copy starts
  const portfolioAggregates = {};
  portfolioCopyData.data.forEach(row => {
    const id = normalizeId(row);
    if (!id) return;
    
    if (!portfolioAggregates[id]) {
      portfolioAggregates[id] = {
        total_portfolio_copy_starts: 0,
        unique_portfolios_interacted: new Set()
      };
    }
    
    portfolioAggregates[id].total_portfolio_copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
    if (row['portfolioTicker']) {
      portfolioAggregates[id].unique_portfolios_interacted.add(row['portfolioTicker']);
    }
  });
  
  // Helper function for time conversion
  function secondsToDays(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    return Math.round((seconds / 86400) * 100) / 100;
  }
  
  // NEW: Define all columns that should be preserved from subscribers insights
  const subscribersInsightColumns = [
    'income', 'netWorth', 'availableCopyCredits', 'buyingPower',
    'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalBuys', 'totalSells', 'totalTrades',
    'totalWithdrawalCount', 'totalWithdrawals', 'investingActivity', 'investingExperienceYears',
    'investingObjective', 'investmentType', 'acquisitionSurvey',
    'A. Linked Bank Account', 'B. Total Deposits ($)', 'C. Total Deposit Count',
    'D. Subscribed within 7 days', 'E. Total Copies', 'F. Total Regular Copies', 'G. Total Premium Copies',
    'H. Regular PDP Views', 'I. Premium PDP Views', 'J. Paywall Views',
    'K. Regular Creator Profile Views', 'L. Premium Creator Profile Views', 'M. Total Subscriptions',
    'N. App Sessions', 'O. Discover Tab Views', 'P. Leaderboard Tab Views', 'Q. Premium Tab Views',
    'R. Stripe Modal Views', 'S. Creator Card Taps', 'T. Portfolio Card Taps'
  ];
  
  // Create main analysis file
  const mainAnalysisData = demoData.data.map(row => {
    const id = normalizeId(row);
    const clean = {};
    
    // Clean original columns with normalized names - PRESERVE ALL EXISTING COLUMNS
    Object.keys(row).forEach(k => {
      const cleanedName = cleanColumnName(k);
      clean[cleanedName] = cleanValue(row[k]);
    });
    
    // NEW: Add any additional subscribers insights columns that weren't in the original demo file
    subscribersInsightColumns.forEach(column => {
      if (!row[column] && row[column] !== 0) {
        // If column doesn't exist in original data, add it as empty
        // This ensures compatibility with future files that might have these columns
        clean[cleanColumnName(column)] = '';
      }
    });
    
    // Add time columns with consistent naming (EXISTING FUNCTIONALITY PRESERVED)
    clean['Time To First Copy'] = secondsToDays(timeToFirstCopyMap[id]);
    clean['Time To Deposit'] = secondsToDays(timeToDepositMap[id]);
    clean['Time To Linked Bank'] = secondsToDays(timeToLinkedBankMap[id]);
    
    // Add aggregated conversion metrics (EXISTING FUNCTIONALITY PRESERVED)
    const conv = conversionAggregates[id] || {};
    const port = portfolioAggregates[id] || {};
    
    // Combine copy starts from both creator-level and portfolio-level data
    const totalCopyStarts = (conv.total_creator_copy_starts || 0) + (port.total_portfolio_copy_starts || 0);
    
    clean['Total Stripe Views'] = conv.total_stripe_views || 0;
    clean['Total Copy Starts'] = totalCopyStarts;
    clean['Unique Creators Interacted'] = conv.unique_creators_interacted ? conv.unique_creators_interacted.size : 0;
    clean['Unique Portfolios Interacted'] = port.unique_portfolios_interacted ? port.unique_portfolios_interacted.size : 0;
    
    return clean;
  });
  
  // Create creator detail file (merge premium + creator copy data) - UNCHANGED
  const creatorDetailMap = {};
  
  // Add premium subscription data
  premiumSubData.data.forEach(row => {
    const id = normalizeId(row);
    const creator = row['creatorUsername'];
    if (!id || !creator) return;
    
    const key = `${id}_${creator}`;
    creatorDetailMap[key] = {
      distinct_id: id,
      creatorUsername: creator,
      paywall_views: parseInt(row['(1) Viewed Creator Paywall'] || 0),
      stripe_views: parseInt(row['(2) Viewed Stripe Modal'] || 0),
      subscriptions: parseInt(row['(3) Subscribed to Creator'] || 0),
      portfolio_views: 0,
      copy_starts: 0,
      copies: 0
    };
  });
  
  // Add creator copy data
  creatorCopyData.data.forEach(row => {
    const id = normalizeId(row);
    const creator = row['creatorUsername'];
    if (!id || !creator) return;
    
    const key = `${id}_${creator}`;
    if (!creatorDetailMap[key]) {
      creatorDetailMap[key] = {
        distinct_id: id,
        creatorUsername: creator,
        paywall_views: 0,
        stripe_views: 0,
        subscriptions: 0,
        portfolio_views: 0,
        copy_starts: 0,
        copies: 0
      };
    }
    
    creatorDetailMap[key].portfolio_views += parseInt(row['(1) Viewed Portfolio Details'] || 0);
    creatorDetailMap[key].copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
    creatorDetailMap[key].copies += parseInt(row['(3) Copied Portfolio'] || 0);
  });
  
  const creatorDetailData = Object.values(creatorDetailMap);
  
  // Create portfolio detail file - UNCHANGED
  const portfolioDetailData = portfolioCopyData.data.map(row => ({
    distinct_id: normalizeId(row),
    portfolioTicker: row['portfolioTicker'],
    portfolio_views: parseInt(row['(1) Viewed Portfolio Details'] || 0),
    copy_starts: parseInt(row['(2) Started Copy Portfolio'] || 0),
    copies: parseInt(row['(3) Copied Portfolio'] || 0)
  })).filter(row => row.distinct_id);
  
  return {
    mainFile: mainAnalysisData,
    creatorFile: creatorDetailData,
    portfolioFile: portfolioDetailData
  };
}

function createMultipleDownloads(results) {
  // Create main analysis file
  const mainHeaders = Object.keys(results.mainFile[0]);
  const mainCSV = [
    mainHeaders.join(','),
    ...results.mainFile.map(row => mainHeaders.map(h => {
      const value = row[h] || '';
      // Properly escape values that contain commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(','))
  ].join('\n');
  
  // Create creator detail file
  const creatorHeaders = ['distinct_id', 'creatorUsername', 'paywall_views', 'stripe_views', 'subscriptions', 'portfolio_views', 'copy_starts', 'copies'];
  const creatorCSV = [
    creatorHeaders.join(','),
    ...results.creatorFile.map(row => creatorHeaders.map(h => row[h] || '').join(','))
  ].join('\n');
  
  // Create portfolio detail file
  const portfolioHeaders = ['distinct_id', 'portfolioTicker', 'portfolio_views', 'copy_starts', 'copies'];
  const portfolioCSV = [
    portfolioHeaders.join(','),
    ...results.portfolioFile.map(row => portfolioHeaders.map(h => row[h] || '').join(','))
  ].join('\n');
  
  // Create download links
  const downloads = [
    { name: 'Main_Analysis_File.csv', content: mainCSV, color: '#28a745' },
    { name: 'Creator_Detail_File.csv', content: creatorCSV, color: '#17a2b8' },
    { name: 'Portfolio_Detail_File.csv', content: portfolioCSV, color: '#ffc107' }
  ];
  
  // Remove any existing download links
  document.querySelectorAll('.download-link-temp').forEach(el => el.remove());
  
  downloads.forEach((download, index) => {
    const blob = new Blob([download.content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = download.name;
    link.className = 'download-link-temp';
    link.style.cssText = `
      position: fixed; top: ${20 + (index * 60)}px; left: 20px; padding: 12px 16px; 
      background: ${download.color}; color: white; text-decoration: none; 
      border-radius: 6px; z-index: 100000; font-weight: bold; font-size: 13px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
    link.textContent = `📥 ${download.name}`;
    document.body.appendChild(link);
    
    // Auto-click to trigger download
    link.click();
    
    // Auto-remove after 60 seconds
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  });
}
