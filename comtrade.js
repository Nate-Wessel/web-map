// use UN comtrade data to construct an SVG chart showing each major trading 
// partner's share of total annual trade in a commodity with Japan 

import { json } from 'd3-fetch'
import { select } from 'd3-selection'
import { 
	stack, area,
	stackOrderNone, stackOffsetNone,
	curveBasis
} from 'd3-shape'
import { scaleLinear, scaleOrdinal } from 'd3-scale'
import { axisLeft, axisBottom } from 'd3-axis'
import { schemeAccent } from 'd3-scale-chromatic'
import { timeParse, timeFormat } from 'd3-time-format'
import { timeYear, timeMonth } from 'd3-time'

const period2date = timeParse('%Y')
const date2period = timeFormat('%Y')

const width = 600
const height = 250
const margin = {top: 5, right: 5, bottom: 20, left: 40}

// Partner IDs for likely major trade partners
// https://comtrade.un.org/Data/cache/partnerAreas.json
const world = 0
const canada = 124

const colors = scaleOrdinal().range(schemeAccent)

export async function addComtradeData( HScode ){

	// add loading text and remove any existing SVG
	let container = select('div#comtradeData')
	container.select('svg').remove()
	let loading = container.append('p').text('Loading...')
	
	// get data for all available times, for world + top trade partners
	let tradePartners = [ world, canada ]
	var sourceData = await getAllDataFor( HScode, tradePartners, 'all' )
	sourceData = uniqueData(sourceData)
	
	// find a list of available dates 
	let periods = getPeriods(sourceData)
	// create the scales and axis functions
	const dateRange = [
		new Date( Math.min(...periods) ),
		new Date( Math.max(...periods) ) ]
	const X = scaleLinear() // time axis
		.domain( dateRange )
		.range( [ 0 + margin.left, width - margin.right ] )
	const xAxis = axisBottom(X)
		.tickFormat( timeFormat('%Y') )
	let maxTradeValue = Math.max( ... 
		sourceData
			.filter( d => d.ptCode == world )
			.map( d => d.TradeValue )
	)
	const Y = scaleLinear() //  trade value axis
		.domain( [ 0, maxTradeValue ] )
		.range( [ height - margin.bottom, 0 + margin.top ] )
	const yAxis = axisLeft(Y).ticks(5,'$.2~s')
	
	const svg = setupSVG()
	
	// apply the axes
	svg.select('g#xAxis')
		.attr('transform',`translate(0,${height-margin.bottom})`)
		.call( xAxis )
	svg.select('g#yAxis')
		.attr('transform',`translate(${margin.left},0)`)
		.call( yAxis )

	updateChart(svg,sourceData,X,Y)
	
	// get trade with ALL partners in the last period
	let newData = await getAllDataFor(
		HScode, 'all', periods.map( p => date2period(p) ).slice(-1)
	)
//	sourceData = uniqueData( sourceData.concat(newData) );
//	updateChart(svg,sourceData,X,Y);
	// of these, find those with >= 5% market share
	let worldTrade = newData.find( d => d.ptCode == world ).TradeValue
	let unqueriedPartners = newData.map( d => {
		if( d.TradeValue >= worldTrade/20 && d.ptCode != world ){
			return d.ptCode
		}
	} ).filter( d => d )
	while(unqueriedPartners.length > 0){
		// pop 5
		let queryPartners = unqueriedPartners.slice(-5)
		unqueriedPartners = unqueriedPartners.slice(0,-5)
		let newData = await getAllDataFor(
			HScode, queryPartners, 'all'
		)
		sourceData = uniqueData( sourceData.concat(newData) );
		updateChart(svg,sourceData,X,Y);
	}
	// remove "loading..." now that we're done
	loading.remove()	
}

function updateChart(svg,data,X,Y){
	// the data needs to be formatted and organized for the stack generator
	let partners = new Set( data.map( d => d.ptTitle ) )
	let periods = getPeriods(data)
	//	remove 
	partners.delete('World')
	
	const allTrade = periods.map( period => {
		let periodData = data
			.filter( d => `${d.period}` == date2period(period) )
		let worldTrade = periodData.find( d => d.ptCode == world ).TradeValue
		let partnerTrade = periodData
			.filter( d => d.ptCode != world )
			.reduce( (a,b) => a + b.TradeValue, 0 )
		if( partnerTrade > worldTrade ){
			console.warn('world trade too small?',period, partnerTrade)
		}
		let trade = { 'period': period, 'Other': worldTrade - partnerTrade }
		for ( let partner of partners ){
			let record = periodData.find( d => d.ptTitle == partner )
			trade[partner] = record ? record.TradeValue : 0
		}
		return trade
	} )

	partners.add('Other')
		
	const areaGen = area()
		.x( d => X(d.data.period) )
		.y0( d => Y(d[0]) )
		.y1( d => Y(d[1]) )
		.curve(curveBasis)
	// apply the stack generator
	let series = stack()
		.keys([...partners])
		.offset( stackOffsetNone )
		.order( stackOrderNone )
		(allTrade)
		
	svg.select('g#dataSpace')
		.selectAll('path')
		.data(series,d=>d.key)
		.join('path')
		.attr('fill', (d,i) => {
			switch(d.key){
				case 'Canada': return 'red'
				case 'Other': return 'grey'
				default: return colors(i)
			}
		} )
		.attr('stroke-width',0.5)
		.attr('stroke','white')
		.attr('d',areaGen)
		.append('title').text(d=>d.key) // country name	
}

function setupSVG(){
	let svg = select('div#comtradeData')
		.append('svg')
		.attr('width',width)
		.attr('height',height)
	svg.append('g').attr('id','dataSpace')
	svg.append('g').attr('id','xAxis')
	svg.append('g').attr('id','yAxis')
	return svg
}

async function getAllDataFor( HScode, partners, periods ){
	// https://comtrade.un.org/Data/Doc/API
	let params = new URLSearchParams({
		'r': 392,       // reporter = japan 
		'rg': 1,        // imports (to Japan)
		'p': typeof(partners) == 'string' ? partners : partners.join(','),
		'freq': 'A',    // monthly 
		'ps': typeof(periods) == 'string' ? periods : periods.join(','),
		'px': 'HS', 'cc': HScode  // search by HS code
	})
	let url = `https://comtrade.un.org/api/get?${params}`
	let response = await json( url )
	return response.dataset
}

function getPeriods(data){
	return [ ... new Set( data.map( d => d.period ) ) ]
		.map( period => period2date( `${period}` ) )
		.sort( (a,b) => a - b )	
}

function uniqueData(data){
	// filter out duplicate data
	const dataPoints = new Set()
	return data.map( d => {
		let uid = `${d.ptCode} - ${d.period}`
		if( ! dataPoints.has(uid) ){
			dataPoints.add(uid)
			return d
		}
	} ).filter( d => d )
}
