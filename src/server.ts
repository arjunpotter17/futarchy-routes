import express, { Request, Response, Application, RequestHandler } from 'express';
import { AutocratClient } from '@metadaoproject/futarchy/dist/v0.4/AutocratClient';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import {getOrCreateAssociatedTokenAccount, getMint} from '@solana/spl-token';
import { PriceMath } from '@metadaoproject/futarchy/dist/v0.4';

const app: Application = express();
const port = process.env.PORT || 9000;

// Initialize Futarchy clients
const connection = new Connection('https://api.mainnet-beta.solana.com');
const provider = anchor.AnchorProvider.env();
const autocratProgram = AutocratClient.createClient({ provider });

// Middleware
app.use(express.json());

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express TypeScript Server!' });
});

// Get all DAOs
app.get('/daos', async (req: Request, res: Response) => {
  try {
    const daos = await autocratProgram.autocrat.account.dao.all();
    res.json({ success: true, daos });
  } catch (error) {
    console.error('Error fetching DAOs:', error);
    res.status(500).json({ error: 'Failed to fetch DAOs' });
  }
});

// Get DAO by ID
app.get('/daos/:id', async (req: Request, res: Response) => {
  try {
    const daoAddress = new PublicKey(req.params.id);
    const dao = await autocratProgram.getDao(daoAddress);
    res.json({ dao });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch DAO' });
  }
});

// Get all proposals for a DAO
app.get('/daos/:id/proposals', async (req: Request, res: Response) => {
  try {
    const daoAddress = new PublicKey(req.params.id);
    const proposals = await autocratProgram.autocrat.account.proposal.all();
    const filteredProposals = proposals.filter(prop => prop.account.dao === daoAddress);
    res.json({ success: true, proposals: filteredProposals });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// Get proposal by ID
app.get('/proposals/:id', async (req: Request, res: Response) => {
  try {
    const proposalAddress = new PublicKey(req.params.id);
    const proposal = await autocratProgram.getProposal(proposalAddress);

    res.json({ success: true, proposal });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch proposal' });
  }
});

// Create a new proposal
app.post('/daos/:id/proposals', (async (req: Request, res: Response) => {
  try {
    const { descriptionUrl, baseTokensToLP, quoteTokensToLP } = req.body;

    if (!descriptionUrl || !baseTokensToLP || !quoteTokensToLP) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const daoAddress = new PublicKey(req.params.id);
    const dao = await autocratProgram.getDao(daoAddress);
    const tokenMint = await getMint(connection, dao.tokenMint);
    const usdcMint = await getMint(connection, dao.usdcMint);
    const tokenDecimals = tokenMint.decimals;
    const usdcDecimals = usdcMint.decimals;

    // Get or create token accounts for the payer
    const metaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      provider.wallet as any, // Type assertion for wallet
      dao.tokenMint,
      (provider.wallet as any).publicKey
    );

    const usdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      provider.wallet as any, // Type assertion for wallet
      dao.usdcMint,
      (provider.wallet as any).publicKey
    );

    // Check balances
    const metaBalance = metaAccount.amount;
    const usdcBalance = usdcAccount.amount;

    // Convert input amounts to chain amounts
    const requiredMeta = PriceMath.getChainAmount(baseTokensToLP, tokenDecimals);
    const requiredUsdc = PriceMath.getChainAmount(quoteTokensToLP, usdcDecimals);

    if (metaBalance < BigInt(requiredMeta.toString()) || usdcBalance < BigInt(requiredUsdc.toString())) {
      return res.status(400).json({ 
        error: 'Insufficient balance for proposal creation',
        requiredMeta: requiredMeta.toString(),
        requiredUsdc: requiredUsdc.toString()
      });
    }

    // Create the proposal instruction
    const accounts = [
      {
        pubkey: daoAddress,
        isSigner: true,
        isWritable: true,
      },
    ];

    const data = autocratProgram.autocrat.coder.instruction.encode("update_dao", {
      daoParams: {
        passThresholdBps: 500,
        baseBurnLamports: null,
        burnDecayPerSlotLamports: null,
        slotsPerProposal: null,
        marketTakerFee: null,
      },
    });

    const ix = {
      programId: autocratProgram.getProgramId(),
      accounts,
      data,
    };

    // Initialize the proposal
    const proposalAddress = await autocratProgram.initializeProposal(
      daoAddress,
      descriptionUrl,
      ix,
      requiredMeta,
      requiredUsdc
    );

    res.json({ 
      success: true, 
      proposalAddress: proposalAddress.toString(),
      message: 'Proposal created successfully' 
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    res.status(500).json({ error: 'Failed to create proposal' });
  }
}) as RequestHandler);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 