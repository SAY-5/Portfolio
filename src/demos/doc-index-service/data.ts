// Seed corpus for the search engine. Twelve short technical documents, each a
// title plus a body paragraph. The vocabulary overlaps across documents on
// purpose so multi-term queries rank differently and TF-IDF has something to
// discriminate on.
import type { Doc } from './types';

export const corpus: Doc[] = [
  {
    id: 'd01',
    title: 'Building an inverted index',
    body: 'An inverted index maps each term to the list of documents that contain it. Building the index means tokenizing every document, lowercasing the tokens, and recording how often each term appears in each document.',
  },
  {
    id: 'd02',
    title: 'Ranking results with TF-IDF',
    body: 'TF-IDF weighs a term by how often it appears in a document against how rare the term is across the whole corpus. A term that is frequent in one document but rare elsewhere earns a high score and pushes that document up the ranking.',
  },
  {
    id: 'd03',
    title: 'Tokenizing text',
    body: 'Tokenizing splits raw text into terms. A simple tokenizer lowercases the input, drops punctuation, and removes common stopwords so that frequent words like the and and do not dominate the index.',
  },
  {
    id: 'd04',
    title: 'Stopwords and noise',
    body: 'Stopwords are high frequency words that carry little meaning for search. Removing them keeps the inverted index smaller and stops common words from drowning out the terms that actually matter to a query.',
  },
  {
    id: 'd05',
    title: 'Computing term frequency',
    body: 'Term frequency counts how many times a term occurs inside a single document. Normalising the count by document length keeps long documents from outranking short ones purely because they hold more words.',
  },
  {
    id: 'd06',
    title: 'Inverse document frequency',
    body: 'Inverse document frequency measures how rare a term is across the corpus. A term that appears in every document is uninformative, so its inverse document frequency is low and it contributes little to the final score.',
  },
  {
    id: 'd07',
    title: 'Generating result snippets',
    body: 'A snippet shows a short window of text around the first matched term so a reader can judge relevance quickly. The matched query terms are marked inside the snippet to make the match obvious at a glance.',
  },
  {
    id: 'd08',
    title: 'Scoring a multi term query',
    body: 'A query with several terms scores each document by summing the TF-IDF weight of every query term that the document contains. Documents matching more of the query terms tend to rank above documents matching only one.',
  },
  {
    id: 'd09',
    title: 'Postings lists explained',
    body: 'A postings list is the set of documents recorded against a single term in the inverted index. Each posting stores the document and the term frequency, and the length of the list is the document frequency of the term.',
  },
  {
    id: 'd10',
    title: 'Query parsing basics',
    body: 'Parsing a query runs it through the same tokenizer used to build the index, lowercasing and dropping stopwords. The surviving query terms are looked up in the inverted index to gather candidate documents.',
  },
  {
    id: 'd11',
    title: 'Index statistics',
    body: 'Useful index statistics include the document count, the number of unique terms, and the total number of postings. These numbers describe the size of the inverted index and how much vocabulary the corpus covers.',
  },
  {
    id: 'd12',
    title: 'Updating the index',
    body: 'Adding a document re-tokenizes its text and merges new postings into the inverted index, while removing a document drops its postings and lowers the document frequency of every term it contained. The statistics update accordingly.',
  },
];
