import {getTextSerializersFromSchema, type TextSerializer} from '@tiptap/core'
import type {Node as PmNode, Schema, Slice} from '@tiptap/pm/model'

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * Plain text for the clipboard that keeps the structure a reader needs: list
 * items keep their markers ("- ", "1. ", "- [ ] ") instead of collapsing into
 * bare lines of text.
 */
export function createClipboardTextSerializer(schema: Schema) {
	const serializers = getTextSerializersFromSchema(schema)

	return (slice: Slice): string => serializeBlocks(slice.content, serializers, '\n\n')
}

function serializeInline(node: PmNode, serializers: Record<string, TextSerializer>): string {
	let text = ''
	node.forEach((child, offset, index) => {
		if (child.isText) {
			text += child.text ?? ''
			return
		}
		const serializer = serializers[child.type.name]
		if (serializer) {
			text += serializer({
				node: child,
				pos: offset,
				parent: node,
				index,
				range: {from: 0, to: child.nodeSize},
			})
			return
		}
		if (child.type.name === 'hardBreak') {
			text += '\n'
			return
		}
		text += child.isLeaf ? (child.type.spec.leafText?.(child) ?? '') : child.textContent
	})
	return text
}

function serializeList(list: PmNode, serializers: Record<string, TextSerializer>): string {
	const lines: string[] = []
	const start = typeof list.attrs.start === 'number' ? list.attrs.start : 1

	list.forEach((item, _offset, index) => {
		let marker = '- '
		if (list.type.name === 'orderedList') {
			marker = `${start + index}. `
		} else if (list.type.name === 'taskList' || item.type.name === 'taskItem') {
			marker = item.attrs.checked ? '- [x] ' : '- [ ] '
		}
		const indent = ' '.repeat(marker.length)
		const body = serializeBlocks(item.content, serializers, '\n')
		const [first = '', ...rest] = body.split('\n')
		lines.push(marker + first + rest.map(line => '\n' + (line === '' ? '' : indent + line)).join(''))
	})

	return lines.join('\n')
}

function serializeBlock(node: PmNode, serializers: Record<string, TextSerializer>): string {
	if (node.isText) {
		return node.text ?? ''
	}
	if (LIST_TYPES.has(node.type.name)) {
		return serializeList(node, serializers)
	}
	if (node.isTextblock) {
		return serializeInline(node, serializers)
	}
	if (node.isLeaf) {
		const serializer = serializers[node.type.name]
		if (serializer) {
			return serializer({node, pos: 0, parent: node, index: 0, range: {from: 0, to: node.nodeSize}})
		}
		return node.type.spec.leafText?.(node) ?? ''
	}
	if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
		return serializeBlocks(node.content, serializers, '\n')
	}
	if (node.type.name === 'tableRow') {
		const cells: string[] = []
		node.forEach(cell => cells.push(serializeBlocks(cell.content, serializers, ' ')))
		return cells.join('\t')
	}
	if (node.type.name === 'table') {
		return serializeBlocks(node.content, serializers, '\n')
	}
	return serializeBlocks(node.content, serializers, '\n\n')
}

function serializeBlocks(
	content: PmNode['content'],
	serializers: Record<string, TextSerializer>,
	separator: string,
): string {
	const parts: string[] = []
	let inline = ''
	content.forEach(child => {
		if (child.isInline) {
			// an open slice can hand us bare inline content
			inline += child.isText ? (child.text ?? '') : serializeBlock(child, serializers)
			return
		}
		if (inline !== '') {
			parts.push(inline)
			inline = ''
		}
		parts.push(serializeBlock(child, serializers))
	})
	if (inline !== '') {
		parts.push(inline)
	}
	return parts.join(separator)
}
